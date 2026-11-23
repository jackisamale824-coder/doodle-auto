import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { rayBox, type Box, type V3 } from "./world.ts";

export type RubblePose = {
  id: number;
  origin: V3;
  p: V3;
  q: [number, number, number, number];
  sleep: boolean;
};
type Cluster = {
  body: RAPIER.RigidBody;
  pose: RubblePose;
  parts: Set<number>;
  contacts: Map<number, RAPIER.Collider>;
  radius: number;
  region: string;
};
const DT = 1 / 60,
  CELL = 16,
  CONTACT_LIMIT = 32;
const identity = { x: 0, y: 0, z: 0, w: 1 };
const vector = (v: V3) => new Vector3(...v);
const tuple = (v: RAPIER.Vector): V3 => [v.x, v.y, v.z];
const volume = (b: Box) => b.s[0] * b.s[1] * b.s[2];
function descriptor(b: Box, dynamic: boolean) {
  if (b.mesh) {
    if (!dynamic)
      return RAPIER.ColliderDesc.trimesh(
        new Float32Array(b.mesh.vertices),
        new Uint32Array(b.mesh.indices),
      );
    // County pitched roof segments are convex prisms. Keep their inclined
    // surfaces rather than allowing a box around the ridge to prop them up.
    const local = Float32Array.from(
      b.mesh.vertices,
      (value, i) => value - b.p[i % 3],
    );
    const hull = RAPIER.ColliderDesc.convexHull(local);
    if (hull) return hull;
  }
  return RAPIER.ColliderDesc.cuboid(b.s[0] / 2, b.s[1] / 2, b.s[2] / 2);
}
export function contactParts(parts: Set<number>, boxes: Box[]) {
  if (parts.size <= CONTACT_LIMIT) return parts;
  // Select actual material at the shell's extreme points. A single enclosing
  // cuboid would create contacts in courtyards, hatchways and broken openings.
  const selected = new Set<number>();
  for (const x of [-1, 0, 1])
    for (const y of [-1, 0, 1])
      for (const z of [-1, 0, 1]) {
        if (!(x || y || z)) continue;
        let best = -Infinity,
          index = -1;
        for (const i of parts) {
          const b = boxes[i];
          const support =
            b.p[0] * x +
            b.p[1] * y +
            b.p[2] * z +
            (b.s[0] * Math.abs(x) +
              b.s[1] * Math.abs(y) +
              b.s[2] * Math.abs(z)) /
              2;
          if (support > best) {
            best = support;
            index = i;
          }
        }
        selected.add(index);
      }
  const largest = [...parts].sort(
    (a, b) => volume(boxes[b]) - volume(boxes[a]),
  );
  for (const i of largest) {
    if (selected.size >= CONTACT_LIMIT) break;
    selected.add(i);
  }
  return selected;
}

export class CountyRubble {
  private world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  private clusters = new Map<number, Cluster>();
  private owner = new Map<number, Cluster>();
  private shapes = new Map<number, RAPIER.Shape>();
  private scenery = new Map<string, number[]>();
  private loaded = new Set<string>();
  private fixed = new Map<number, RAPIER.Collider>();
  private removed = new Set<number>();
  private active = false;
  private accumulated = 0;
  private previousMotion?: { id: number; at: Vector3; v: Vector3; w: Vector3 };
  constructor(private boxes: Box[]) {
    this.world.timestep = DT;
    this.indexScenery();
  }

  // Build only an index of source bounds. Populate the WASM broadphase on
  // demand as a moving cluster enters a cell, and share it among all clusters.
  private indexScenery() {
    this.boxes.forEach((b, i) => {
      if (b.solid) this.indexBox(i, false);
    });
  }
  private indexBox(index: number, changed: boolean) {
    const b = this.boxes[index];
    for (
      let x = Math.floor((b.p[0] - b.s[0] / 2) / CELL);
      x <= Math.floor((b.p[0] + b.s[0] / 2) / CELL);
      x++
    ) {
      for (
        let z = Math.floor((b.p[2] - b.s[2] / 2) / CELL);
        z <= Math.floor((b.p[2] + b.s[2] / 2) / CELL);
        z++
      ) {
        const key = x + "," + z,
          bucket = this.scenery.get(key);
        if (!bucket) this.scenery.set(key, [index]);
        else if (!changed || !bucket.includes(index)) bucket.push(index);
        if (changed && !this.fixed.has(index)) {
          for (
            let y = Math.floor((b.p[1] - b.s[1] / 2) / CELL);
            y <= Math.floor((b.p[1] + b.s[1] / 2) / CELL);
            y++
          ) {
            if (this.loaded.has(key + "," + y)) {
              this.addFixed(index);
              break;
            }
          }
        }
      }
    }
  }
  private addFixed(index: number) {
    const b = this.boxes[index],
      desc = descriptor(b, false).setFriction(0.78);
    if (!b.mesh) desc.setTranslation(...b.p);
    this.fixed.set(index, this.world.createCollider(desc));
  }
  syncStatic(index: number) {
    this.removeStatic(index);
    if (!this.boxes[index].solid) return;
    this.removed.delete(index);
    if (this.scenery.size) this.indexBox(index, true);
  }
  private loadSurroundings(c: Cluster) {
    const p = c.body.translation(),
      r = c.radius + 2;
    const x0 = Math.floor((p.x - r) / CELL),
      x1 = Math.floor((p.x + r) / CELL);
    const z0 = Math.floor((p.z - r) / CELL),
      z1 = Math.floor((p.z + r) / CELL);
    const y0 = Math.floor((p.y - r) / CELL),
      y1 = Math.floor((p.y + r) / CELL);
    const region = [x0, x1, y0, y1, z0, z1].join(",");
    if (region === c.region) return;
    c.region = region;
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const cell = x + "," + z,
          indices = this.scenery.get(cell);
        if (!indices) continue;
        for (let y = y0; y <= y1; y++) {
          const key = cell + "," + y;
          if (this.loaded.has(key)) continue;
          this.loaded.add(key);
          for (const i of indices) {
            const b = this.boxes[i];
            if (
              !b.solid ||
              this.fixed.has(i) ||
              this.removed.has(i) ||
              b.p[1] + b.s[1] / 2 < y * CELL ||
              b.p[1] - b.s[1] / 2 > (y + 1) * CELL
            )
              continue;
            this.addFixed(i);
          }
        }
      }
  }
  removeStatic(index: number) {
    this.removed.add(index);
    const collider = this.fixed.get(index);
    if (!collider) return;
    this.world.contactPairsWith(collider, (other) => other.parent()?.wakeUp());
    this.world.removeCollider(collider, true);
    this.fixed.delete(index);
    this.active = true;
  }
  private rebuild(c: Cluster) {
    const wanted = contactParts(c.parts, this.boxes);
    for (const [i, collider] of c.contacts)
      if (!wanted.has(i)) {
        this.world.removeCollider(collider, true);
        c.contacts.delete(i);
      }
    for (const i of wanted) {
      if (c.contacts.has(i)) continue;
      const b = this.boxes[i],
        o = c.pose.origin;
      const d = descriptor(b, true)
        .setTranslation(b.p[0] - o[0], b.p[1] - o[1], b.p[2] - o[2])
        .setFriction(0.78)
        .setRestitution(0)
        .setDensity(0);
      c.contacts.set(i, this.world.createCollider(d, c.body));
    }
    // The contact budget must not move a tower's center of gravity toward
    // whichever slabs were selected as proxies. All surviving members
    // contribute their mass and parallel-axis moments in the building axes.
    const center = new Vector3();
    let mass = 0;
    for (const i of c.parts) {
      const b = this.boxes[i],
        m = volume(b) * (b.mesh ? 0.5 : 1);
      mass += m;
      center.addScaledVector(vector(b.p), m);
    }
    center.divideScalar(mass);
    const inertia = new Vector3();
    for (const i of c.parts) {
      const b = this.boxes[i],
        m = volume(b) * (b.mesh ? 0.5 : 1);
      const [w, h, d] = b.s;
      const x = b.p[0] - center.x,
        y = b.p[1] - center.y,
        z = b.p[2] - center.z;
      inertia.x += m * ((h * h + d * d) / 12 + y * y + z * z);
      inertia.y += m * ((w * w + d * d) / 12 + x * x + z * z);
      inertia.z += m * ((w * w + h * h) / 12 + x * x + y * y);
    }
    center.sub(vector(c.pose.origin));
    c.body.setAdditionalMassProperties(mass, center, inertia, identity, true);
    c.body.recomputeMassPropertiesFromColliders();
  }
  spawn(
    id: number,
    indices: number[],
    direction: V3,
    initialPose?: RubblePose,
  ): RubblePose {
    const existing = this.clusters.get(id);
    if (existing) return existing.pose;
    const parts = new Set(indices);
    if (!parts.size)
      throw new Error("A rubble cluster requires at least one component");
    const lo: V3 = [Infinity, Infinity, Infinity],
      hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const i of parts) {
      const b = this.boxes[i];
      this.removeStatic(i);
      for (let j = 0; j < 3; j++) {
        lo[j] = Math.min(lo[j], b.p[j] - b.s[j] / 2);
        hi[j] = Math.max(hi[j], b.p[j] + b.s[j] / 2);
      }
    }
    const origin = lo.map((v, j) => (v + hi[j]) / 2) as V3;
    const q = new Quaternion(),
      position = new Vector3(...origin);
    if (initialPose) {
      q.fromArray(initialPose.q);
      position
        .sub(new Vector3(...initialPose.origin))
        .applyQuaternion(q)
        .add(new Vector3(...initialPose.p));
    }
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(position.x, position.y, position.z)
        .setRotation(q)
        .setLinearDamping(0.12)
        .setAngularDamping(0.24)
        .setSoftCcdPrediction(0.4),
    );
    const pose: RubblePose = {
      id,
      origin,
      p: position.toArray(),
      q: q.toArray(),
      sleep: false,
    };
    const c: Cluster = {
      body,
      pose,
      parts,
      contacts: new Map(),
      region: "",
      radius: Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2,
    };
    this.rebuild(c);
    const horizontal = new Vector3(direction[0], 0, direction[2]);
    if (horizontal.lengthSq() < 1e-8) horizontal.set(1, 0, 0);
    horizontal.normalize();
    const parent = initialPose && this.clusters.get(initialPose.id);
    if (parent) {
      body.setLinvel(parent.body.velocityAtPoint(body.worldCom()), true);
      body.setAngvel(parent.body.angvel(), true);
    } else if (initialPose && this.previousMotion?.id === initialPose.id) {
      const m = this.previousMotion,
        at = new Vector3().copy(body.worldCom());
      body.setLinvel(m.w.clone().cross(at.sub(m.at)).add(m.v), true);
      body.setAngvel(m.w, true);
    } else if (!initialPose) {
      const height = hi[1] - lo[1];
      const slender = height > Math.max(hi[0] - lo[0], hi[2] - lo[2]);
      const speed = Math.min(
        1.6,
        (slender ? 1.35 : 0.9) * Math.sqrt(9.81 / Math.max(1, height)),
      );
      body.setAngvel(
        { x: horizontal.z * speed, y: 0, z: -horizontal.x * speed },
        true,
      );
      // A tall assembly starts to roll around its bearing edge. Give its
      // center the matching horizontal velocity, capped at walking/running
      // speed so a low panel cannot launch neighbouring pieces.
      const lateral = slender
        ? Math.min(5.5, speed * (body.worldCom().y - lo[1]))
        : 0.65;
      body.setLinvel(horizontal.multiplyScalar(lateral), true);
    }
    this.clusters.set(id, c);
    for (const i of parts) this.owner.set(i, c);
    this.active = true;
    return pose;
  }
  removePart(index: number) {
    this.removeParts([index]);
  }
  removeParts(indices: number[]) {
    const affected = new Set<Cluster>();
    for (const i of indices) {
      const c = this.owner.get(i);
      if (!c) continue;
      c.parts.delete(i);
      this.owner.delete(i);
      this.shapes.delete(i);
      affected.add(c);
    }
    for (const c of affected) {
      if (c.parts.size) {
        this.rebuild(c);
        c.body.wakeUp();
      } else {
        this.previousMotion = {
          id: c.pose.id,
          at: new Vector3().copy(c.body.worldCom()),
          v: new Vector3().copy(c.body.linvel()),
          w: new Vector3().copy(c.body.angvel()),
        };
        this.world.removeRigidBody(c.body);
        this.clusters.delete(c.pose.id);
      }
    }
    if (affected.size) this.active = true;
  }
  step(dt: number): RubblePose[] {
    if (!this.active || !(dt > 0)) return [];
    this.accumulated += Math.min(dt, 0.15);
    if (this.accumulated + 1e-9 < DT) return [];
    for (const c of this.clusters.values())
      if (!c.body.isSleeping()) this.loadSurroundings(c);
    while (this.accumulated + 1e-9 >= DT) {
      this.world.step();
      this.accumulated -= DT;
    }
    this.active = false;
    const changes: RubblePose[] = [];
    for (const c of this.clusters.values()) {
      const sleep = c.body.isSleeping();
      if (!sleep) this.active = true;
      if (sleep && c.pose.sleep) continue;
      const p = c.body.translation(),
        q = c.body.rotation(),
        old = c.pose;
      if (
        old.sleep === sleep &&
        p.x === old.p[0] &&
        p.y === old.p[1] &&
        p.z === old.p[2] &&
        q.x === old.q[0] &&
        q.y === old.q[1] &&
        q.z === old.q[2] &&
        q.w === old.q[3]
      )
        continue;
      c.pose = {
        id: old.id,
        origin: old.origin,
        p: tuple(p),
        q: [q.x, q.y, q.z, q.w],
        sleep,
      };
      changes.push(c.pose);
    }
    if (!this.active) this.accumulated = 0;
    return changes;
  }
  ray(o: V3, d: V3, max: number) {
    let distance = max,
      box: Box | null = null;
    const lengthSquared = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (!lengthSquared) return null;
    for (const { pose, parts, radius } of this.clusters.values()) {
      const x = pose.p[0] - o[0],
        y = pose.p[1] - o[1],
        z = pose.p[2] - o[2];
      const t = Math.max(
        0,
        Math.min(distance, (x * d[0] + y * d[1] + z * d[2]) / lengthSquared),
      );
      if (
        (x - d[0] * t) ** 2 + (y - d[1] * t) ** 2 + (z - d[2] * t) ** 2 >
        radius * radius
      )
        continue;
      const inverse = new Quaternion(...pose.q).conjugate();
      const origin = new Vector3(...o)
        .sub(vector(pose.p))
        .applyQuaternion(inverse)
        .add(vector(pose.origin))
        .toArray();
      const direction = new Vector3(...d).applyQuaternion(inverse).toArray();
      for (const i of parts) {
        const hit = rayBox(origin, direction, this.boxes[i], distance);
        if (hit !== null && hit < distance) {
          distance = hit;
          box = this.boxes[i];
        }
      }
    }
    return box
      ? { box, distance, point: o.map((n, i) => n + d[i] * distance) as V3 }
      : null;
  }
  overlaps(p: V3, height: number) {
    if (!this.clusters.size) return false;
    const r = Math.min(0.3, height / 2),
      cylinder = Math.max(0, (height - 0.06) / 2 - r);
    const center = new Vector3(p[0], p[1] + height / 2 + 0.02, p[2]);
    const capsule = new RAPIER.Capsule(cylinder, r);
    for (const { pose, parts, radius } of this.clusters.values()) {
      if (
        center.distanceToSquared(new Vector3(...pose.p)) >
        (radius + height) ** 2
      )
        continue;
      const inverse = new Quaternion(...pose.q).conjugate();
      const local = center
        .clone()
        .sub(vector(pose.p))
        .applyQuaternion(inverse)
        .add(vector(pose.origin));
      const axis = new Vector3(0, cylinder, 0).applyQuaternion(inverse);
      for (const i of parts) {
        const b = this.boxes[i];
        if (
          Math.abs(local.x - b.p[0]) > Math.abs(axis.x) + r + b.s[0] / 2 ||
          Math.abs(local.y - b.p[1]) > Math.abs(axis.y) + r + b.s[1] / 2 ||
          Math.abs(local.z - b.p[2]) > Math.abs(axis.z) + r + b.s[2] / 2
        )
          continue;
        let shape = this.shapes.get(i);
        if (!shape) {
          shape = descriptor(b, true).shape;
          this.shapes.set(i, shape);
        }
        if (
          shape.intersectsShape(vector(b.p), identity, capsule, local, inverse)
        )
          return true;
      }
    }
    return false;
  }
  dispose() {
    this.world.free();
    this.clusters.clear();
    this.owner.clear();
    this.shapes.clear();
    this.scenery.clear();
    this.fixed.clear();
    this.removed.clear();
    this.loaded.clear();
    this.active = false;
  }
}
