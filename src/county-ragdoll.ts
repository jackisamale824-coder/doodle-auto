import { Matrix4, Object3D, Quaternion, Vector3 } from "three";
import type { Doodle } from "./actors.ts";
import type { VehicleKind } from "./county.ts";
import { VEHICLE_DIMENSIONS } from "./county-vehicle-dimensions.ts";
import type { Physics } from "./physics.ts";
import { rayBox, type V3 } from "./world.ts";

export function carBodyHit(
  from: V3,
  to: V3,
  yaw: number,
  speed: number,
  p: V3,
  kind: VehicleKind = "saloon",
) {
  const dx = to[0] - from[0],
    dz = to[2] - from[2];
  const travel = Math.hypot(dx, dz),
    magnitude = Math.abs(speed);
  if (travel < 0.0001 || magnitude < 3) return null;
  // Reject distant actors before rotating the sweep into the car frame.
  if (
    p[0] < Math.min(from[0], to[0]) - 3.4 ||
    p[0] > Math.max(from[0], to[0]) + 3.4 ||
    p[2] < Math.min(from[2], to[2]) - 3.4 ||
    p[2] > Math.max(from[2], to[2]) + 3.4
  )
    return null;
  const [width, length, height] = VEHICLE_DIMENSIONS[kind];
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  // In the car's local frame the NPC moves backwards through the chassis.
  // Expand its shape by the NPC silhouette so bumper/corner contacts count.
  const x = p[0] - from[0],
    z = p[2] - from[2];
  const local: V3 = [x * c - z * s, p[1] - from[1], x * s + z * c];
  const sweep: V3 = [-dx * c + dz * s, from[1] - to[1], -dx * s - dz * c];
  const entry = rayBox(
    local,
    sweep,
    {
      p: [0, (height - 1.65) / 2, 0],
      s: [2 * (width + 0.26), height + 1.65, 2 * (length + 0.23)],
      kind: "chassis",
      solid: true,
    },
    1,
  );
  if (entry === null) return null;
  const side = Math.max(-1, Math.min(1, (local[0] + entry * sweep[0]) / width));
  const push = Math.min(13, magnitude * 0.6);
  const impulse: V3 = [
    push * (dx / travel + 0.35 * side * c),
    Math.min(6.4, 2.2 + magnitude * 0.16),
    push * (dz / travel - 0.35 * side * s),
  ];
  return { damage: Math.min(140, Math.round(magnitude * 3.8)), impulse };
}

export const KNOCKDOWN_TIME = 2.15;
type WorldRay = (
  origin: V3,
  direction: V3,
  max: number,
) => { distance: number } | null;

// The server and offline simulation advance the same compact root state. The
// visual joints never take ownership of the NPC's position or damage.
export function stepKnockback(p: V3, velocity: V3, dt: number, ray: WorldRay) {
  let remaining = Math.max(0, Math.min(0.25, dt)),
    grounded = false;
  while (remaining > 0.000001) {
    const h = Math.min(1 / 60, remaining);
    remaining -= h;
    const speed = Math.hypot(velocity[0], velocity[2]);
    if (speed > 0.02) {
      const dir: V3 = [velocity[0] / speed, 0, velocity[2] / speed];
      const travel = h * speed,
        radius = 0.26;
      const wall = ray([p[0], p[1] + 0.34, p[2]], dir, travel + radius);
      const allowed = wall ? Math.max(0, wall.distance - radius) : travel;
      p[0] += dir[0] * allowed;
      p[2] += dir[2] * allowed;
      if (wall) velocity[0] = velocity[2] = 0;
    }
    velocity[1] -= 17 * h;
    const dy = velocity[1] * h;
    grounded = false;
    if (dy > 0) {
      const roof = ray([p[0], p[1] + 0.52, p[2]], [0, 1, 0], dy + 0.03);
      if (roof) velocity[1] = 0;
      else p[1] += dy;
    } else {
      const lift = 0.22;
      const floor = ray(
        [p[0], p[1] + lift, p[2]],
        [0, -1, 0],
        lift - dy + 0.004,
      );
      if (floor) {
        p[1] += lift - floor.distance;
        velocity[1] = 0;
        grounded = true;
      } else p[1] += dy;
    }
    const drag = Math.exp(-h * (grounded ? 8 : 1.2));
    velocity[0] *= drag;
    velocity[2] *= drag;
  }
  return grounded;
}

const H = 1 / 30,
  RANGE = 55,
  MAX_BODIES = 6;
const down = new Vector3(0, -1, 0);
const direction = new Vector3(),
  across = new Vector3(),
  up = new Vector3(),
  forward = new Vector3();
const center = new Vector3(),
  offset = new Vector3(),
  probe = new Vector3();
const rotation = new Quaternion(),
  parentRotation = new Quaternion(),
  basis = new Matrix4();

// Contacts and constraints reference the same joints used by the visible mesh.
function bones(d: Doodle) {
  return [
    d.leftLeg,
    d.rightLeg,
    d.leftArm,
    d.rightArm,
    d.head,
    d.leftKnee,
    d.leftFoot,
    d.rightKnee,
    d.rightFoot,
    d.leftElbow,
    d.leftHand,
    d.rightElbow,
    d.rightHand,
  ];
}
const radii = [
  0.16, 0.16, 0.14, 0.14, 0.25, 0.09, 0.087, 0.09, 0.087, 0.07, 0.07, 0.07,
  0.07,
];
const chains = [
  [0, 5, 6],
  [1, 7, 8],
  [2, 9, 10],
  [3, 11, 12],
];
interface Joint {
  p: Vector3;
  previous: Vector3;
}
interface Stick {
  a: number;
  b: number;
  length: number;
  minimum?: boolean;
}
interface Pose {
  bone: Object3D;
  q: Quaternion;
}
interface Body {
  model: Doodle;
  parts: Object3D[];
  joints: Joint[];
  sticks: Stick[];
  rest: Pose[];
  pelvisRest: Vector3;
  dead: boolean;
  age: number;
  accumulator: number;
}

function constrain(joints: Joint[], stick: Stick) {
  const a = joints[stick.a].p,
    b = joints[stick.b].p;
  direction.subVectors(b, a);
  const len = direction.length();
  if (len < 0.00001 || (stick.minimum && len >= stick.length)) return;
  direction.multiplyScalar((len - stick.length) / (2 * len));
  a.add(direction);
  b.sub(direction);
}
function aimBone(bone: Object3D, a: Vector3, b: Vector3) {
  bone.parent!.getWorldQuaternion(parentRotation).invert();
  direction.subVectors(b, a).normalize().applyQuaternion(parentRotation);
  bone.quaternion.setFromUnitVectors(down, direction);
}

export class CountyRagdolls {
  private playerBodies = new WeakSet<Doodle>();
  playerDeath(model: Doodle, yaw: number, eye: Vector3) {
    if (
      this.hit(
        model,
        [Math.sin(yaw) * 1.8, 0.6, Math.cos(yaw) * 1.8],
        eye,
        true,
      )
    )
      this.playerBodies.add(model);
    else model.fall(1);
  }
  private bodies = new Map<Doodle, Body>();
  constructor(private physics: Pick<Physics, "ray">) {}
  has(model: Doodle) {
    return this.bodies.has(model);
  }

  markDead(model: Doodle) {
    const current = this.bodies.get(model);
    if (current) current.dead = true;
  }
  hit(model: Doodle, impulse: V3, eye: Vector3, dead = false, age = 0) {
    if (age >= KNOCKDOWN_TIME) {
      if (dead) model.finishCarFall(true);
      return false;
    }
    if (eye.distanceToSquared(model.group.position) > RANGE * RANGE)
      return false;
    this.remove(model);
    if (this.bodies.size >= MAX_BODIES) {
      // Retain the impacts nearest the camera during a pile-up.
      let farthest = model,
        farthestDistance = eye.distanceToSquared(model.group.position);
      for (const candidate of this.bodies.keys()) {
        const distance = eye.distanceToSquared(candidate.group.position);
        if (distance >= farthestDistance) {
          farthest = candidate;
          farthestDistance = distance;
        }
      }
      if (farthest === model) return false;
      this.remove(farthest);
    }
    const parts = bones(model);
    const rest = [model.pelvis, model.spine, ...parts].map((bone) => ({
      bone,
      q: bone.quaternion.clone(),
    }));
    model.group.updateWorldMatrix(true, true);
    const joints = parts.map((bone) => {
      const p = bone.getWorldPosition(new Vector3());
      return { p, previous: p.clone() };
    });
    const sticks: Stick[] = [];
    const stick = (a: number, b: number) =>
      sticks.push({ a, b, length: joints[a].p.distanceTo(joints[b].p) });
    // The hips, shoulders and head form one torso. Each elbow and knee is free
    // to bend while its two adjoining segments retain their original lengths.
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) stick(a, b);
    for (const [root, joint, end] of chains) {
      stick(root, joint);
      stick(joint, end);
      // Keep the forearm and shin from folding completely through their upper segment.
      sticks.push({
        a: root,
        b: end,
        length: root < 2 ? 0.25 : 0.19,
        minimum: true,
      });
    }
    const force = new Vector3(...impulse);
    if (age > 0.18) {
      // A new observer already has the authoritative knocked-down location.
      // Seed a prone pose there without replaying the original flight.
      direction.set(-force.z, 0, force.x);
      if (direction.lengthSq() < 0.01) direction.set(1, 0, 0);
      rotation.setFromAxisAngle(direction.normalize(), 1.47);
      center.addVectors(joints[0].p, joints[1].p).multiplyScalar(0.5);
      for (const j of joints) {
        j.p.sub(center).applyQuaternion(rotation).add(model.group.position);
        j.p.y += 0.32;
        j.previous.copy(j.p);
      }
    } else {
      for (const [i, j] of joints.entries()) {
        const gain = i === 4 ? 0.32 : i === 6 || i === 8 ? 1.32 : 0.84;
        j.previous.addScaledVector(force, -H * gain);
        // Small opposing impulses splay the arms and break bilateral symmetry.
        if (i === 10 || i === 12) {
          const side = i === 10 ? -1 : 1;
          j.previous.x -= Math.cos(model.group.rotation.y) * side * H * 1.7;
          j.previous.z += Math.sin(model.group.rotation.y) * side * H * 1.7;
        }
      }
    }
    const body = {
      model,
      parts,
      joints,
      sticks,
      rest,
      pelvisRest: model.pelvis.position.clone(),
      age: Math.max(0, age),
      dead,
      accumulator: 0,
    };
    this.bodies.set(model, body);
    model.aimRig.visible = false;
    model.group.visible = true;
    this.pose(body);
    return true;
  }

  private simulate(b: Body) {
    const { joints } = b;
    center.addVectors(joints[0].p, joints[1].p).multiplyScalar(0.5);
    // Network correction nudges the particle assembly toward the interpolated
    // actor. Contact is resolved after correction, including against rubble.
    offset.subVectors(b.model.group.position, center);
    offset.y = 0;
    const drift = offset.length();
    offset.multiplyScalar(
      drift > 0.45 ? Math.min(1, ((drift - 0.45) * 0.22) / drift) : 0,
    );
    for (const j of joints) {
      direction.subVectors(j.p, j.previous).multiplyScalar(0.975);
      j.previous.copy(j.p);
      j.p.add(direction).add(offset);
      j.p.y -= 17 * H * H;
    }
    for (let iteration = 0; iteration < 5; iteration++) {
      for (const stick of b.sticks) constrain(joints, stick);
    }
    for (const [i, j] of joints.entries()) {
      const radius = radii[i];
      direction.subVectors(j.p, j.previous);
      direction.y = 0;
      const len = direction.length();
      if (len > 0.0005) {
        direction.multiplyScalar(1 / len);
        const wall = this.physics.ray(j.previous, direction, len + radius);
        if (wall) {
          const travel = Math.max(0, wall.distance - radius);
          j.p.x = j.previous.x + direction.x * travel;
          j.p.z = j.previous.z + direction.z * travel;
        }
      }
      const rise = j.p.y - j.previous.y;
      if (rise > 0.005) {
        probe.set(j.p.x, j.previous.y, j.p.z);
        const ceiling = this.physics.ray(probe, up.set(0, 1, 0), rise + radius);
        if (ceiling)
          j.p.y = j.previous.y + Math.max(0, ceiling.distance - radius);
      }
      // Begin above the higher sample to catch fast falls and low curb steps.
      probe.set(j.p.x, Math.max(j.p.y, j.previous.y) + radius + 0.12, j.p.z);
      const contact = this.physics.ray(probe, down, probe.y - j.p.y + radius);
      if (contact) {
        j.p.y = probe.y - contact.distance + radius;
        j.previous.x += (j.p.x - j.previous.x) * 0.35;
        j.previous.z += (j.p.z - j.previous.z) * 0.35;
        j.previous.y = j.p.y;
      }
    }
  }

  private pose(b: Body) {
    const { model: m, joints: j, parts } = b;
    across
      .subVectors(j[3].p, j[2].p)
      .add(direction.subVectors(j[1].p, j[0].p))
      .normalize();
    center.addVectors(j[0].p, j[1].p).multiplyScalar(0.5);
    // Aim the rigid torso toward the contacted head center. The shoulders
    // establish twist, while the helmet keeps its clearance above the floor.
    up.subVectors(j[4].p, center).normalize();
    forward.crossVectors(across, up).normalize();
    across.crossVectors(up, forward).normalize();
    rotation.setFromRotationMatrix(basis.makeBasis(across, up, forward));
    m.group.getWorldQuaternion(parentRotation).invert();
    m.pelvis.quaternion.multiplyQuaternions(parentRotation, rotation);
    m.pelvis.position
      .copy(m.group.worldToLocal(center))
      .sub(offset.set(0, 0.7, 0).applyQuaternion(m.pelvis.quaternion));
    m.spine.quaternion.identity();
    for (const [root, joint, end] of chains) {
      aimBone(parts[root], j[root].p, j[joint].p);
      aimBone(parts[joint], j[joint].p, j[end].p);
    }
    if (!b.dead) {
      const t = Math.max(0, (b.age - (KNOCKDOWN_TIME - 0.48)) / 0.48);
      const blend = t * t * (3 - 2 * t);
      for (const { bone, q } of b.rest) bone.quaternion.slerp(q, blend);
      m.pelvis.position.lerp(b.pelvisRest, blend);
    }
  }

  update(dt: number, eye: Vector3) {
    for (const [m, b] of this.bodies) {
      b.age += Math.max(0, dt);
      if (b.age >= KNOCKDOWN_TIME && this.playerBodies.has(m)) continue;
      if (
        b.age >= KNOCKDOWN_TIME ||
        eye.distanceToSquared(m.group.position) > RANGE * RANGE
      ) {
        this.remove(m);
        continue;
      }
      b.accumulator += Math.max(0, Math.min(0.12, dt));
      while (b.accumulator + 1e-10 >= H) {
        this.simulate(b);
        b.accumulator -= H;
      }
      m.aimRig.visible = false;
      this.pose(b);
    }
  }

  remove(model: Doodle) {
    this.playerBodies.delete(model);
    const b = this.bodies.get(model);
    if (!b) return;
    for (const { bone, q } of b.rest) bone.quaternion.copy(q);
    model.pelvis.position.copy(b.pelvisRest);
    model.finishCarFall(b.dead);
    this.bodies.delete(model);
  }
  dispose() {
    for (const m of this.bodies.keys()) this.remove(m);
  }
}
