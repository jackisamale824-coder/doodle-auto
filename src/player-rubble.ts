import RAPIER from "@dimforge/rapier3d-compat";
import { Box3, Quaternion, Vector3 } from "three";
import type { RubblePose } from "./county-rubble.ts";
import type { RubbleCluster } from "./county-wreckage.ts";
import { rayBox, type Box, type V3 } from "./world.ts";

interface Member {
  index: number;
  box: Box;
  bounds: Box3;
  shape?: RAPIER.Shape;
}
interface Assembly {
  members: Map<number, Member>;
  origin: Vector3;
  position: Vector3;
  rotation: Quaternion;
  inverse: Quaternion;
  radius: number;
  // Only members near the character enter the character-controller world.
  body?: RAPIER.RigidBody;
  active: Map<number, RAPIER.Collider>;
  moved: boolean;
}
const identity = { x: 0, y: 0, z: 0, w: 1 };
function shape(m: Member) {
  if (m.shape) return m.shape;
  const b = m.box;
  if (b.mesh) {
    const points = Float32Array.from(b.mesh.vertices, (v, k) => v - b.p[k % 3]);
    m.shape = RAPIER.ColliderDesc.convexHull(points)?.shape;
  }
  return (m.shape ??= new RAPIER.Cuboid(b.s[0] / 2, b.s[1] / 2, b.s[2] / 2));
}

export class PlayerRubble {
  private assemblies = new Map<number, Assembly>();
  private owners = new Map<number, Assembly>();
  private from = new Vector3();
  private to = new Vector3();
  private axis = new Vector3();
  private probe = new Vector3();
  private bounds = new Box3();
  private retain = new Box3();
  constructor(
    private world: RAPIER.World,
    private boxes: Box[],
  ) {}
  get size() {
    return this.assemblies.size;
  }
  add(cluster: RubbleCluster) {
    const { id, pose } = cluster;
    const a: Assembly = {
      members: new Map(),
      origin: new Vector3(...pose.origin),
      position: new Vector3(...pose.p),
      rotation: new Quaternion(...pose.q),
      inverse: new Quaternion(...pose.q).conjugate(),
      radius: 0,
      active: new Map(),
      moved: false,
    };
    for (const index of cluster.indices) {
      const b = this.boxes[index];
      if (!b) continue;
      const bounds = new Box3().setFromCenterAndSize(
        new Vector3(...b.p),
        new Vector3(...b.s),
      );
      const dx = Math.abs(b.p[0] - a.origin.x) + b.s[0] / 2,
        dy = Math.abs(b.p[1] - a.origin.y) + b.s[1] / 2,
        dz = Math.abs(b.p[2] - a.origin.z) + b.s[2] / 2;
      a.radius = Math.max(a.radius, Math.hypot(dx, dy, dz));
      a.members.set(index, { index, box: b, bounds });
      this.owners.set(index, a);
    }
    this.assemblies.set(id, a);
  }
  pose(p: RubblePose) {
    const a = this.assemblies.get(p.id);
    if (!a) return;
    if (
      a.position.x === p.p[0] &&
      a.position.y === p.p[1] &&
      a.position.z === p.p[2] &&
      a.rotation.x === p.q[0] &&
      a.rotation.y === p.q[1] &&
      a.rotation.z === p.q[2] &&
      a.rotation.w === p.q[3]
    )
      return;
    a.position.fromArray(p.p);
    a.rotation.fromArray(p.q);
    a.inverse.copy(a.rotation).conjugate();
    a.moved = true;
  }
  private local(v: Vector3, a: Assembly) {
    return v.sub(a.position).applyQuaternion(a.inverse).add(a.origin);
  }
  private release(a: Assembly) {
    if (!a.body) return false;
    this.world.removeRigidBody(a.body);
    a.body = undefined;
    a.active.clear();
    return true;
  }
  remove(index: number) {
    const a = this.owners.get(index);
    if (!a) return false;
    this.owners.delete(index);
    a.members.delete(index);
    const collider = a.active.get(index);
    if (collider) {
      this.world.removeCollider(collider, false);
      a.active.delete(index);
    }
    if (!a.active.size) this.release(a);
    if (!a.members.size) {
      for (const [id, assembly] of this.assemblies)
        if (assembly === a) this.assemblies.delete(id);
    }
    return !!collider;
  }
  clear() {
    let changed = false;
    for (const a of this.assemblies.values())
      if (this.release(a)) changed = true;
    this.owners.clear();
    this.assemblies.clear();
    return changed;
  }

  // The swept capsule plus autostep, ground snap and a small margin is the
  // activation region. A larger retention region avoids churn at its borders.
  prepareMovement(p: Vector3, delta: Vector3, height: number) {
    if (!this.assemblies.size) return false;
    let dirty = false;
    const sweptRadius = height / 2 + delta.length() / 2 + 3.5;
    const mid = this.probe.copy(p).addScaledVector(delta, 0.5);
    mid.y += height / 2;
    for (const a of this.assemblies.values()) {
      if (mid.distanceToSquared(a.position) > (a.radius + sweptRadius) ** 2) {
        if (this.release(a)) dirty = true;
        continue;
      }
      this.from.copy(p);
      this.from.y += height / 2;
      this.local(this.from, a);
      this.to.copy(delta).applyQuaternion(a.inverse).add(this.from);
      this.axis.set(0, height / 2, 0).applyQuaternion(a.inverse);
      this.axis.set(
        Math.abs(this.axis.x) + 1.1,
        Math.abs(this.axis.y) + 1.1,
        Math.abs(this.axis.z) + 1.1,
      );
      this.bounds.min.copy(this.from).min(this.to).sub(this.axis);
      this.bounds.max.copy(this.from).max(this.to).add(this.axis);
      this.retain.copy(this.bounds).expandByScalar(2);
      for (const m of a.members.values()) {
        const collider = a.active.get(m.index);
        if (collider) {
          if (this.retain.intersectsBox(m.bounds)) continue;
          this.world.removeCollider(collider, false);
          a.active.delete(m.index);
          dirty = true;
        } else if (this.bounds.intersectsBox(m.bounds)) {
          if (!a.body) {
            a.body = this.world.createRigidBody(
              RAPIER.RigidBodyDesc.kinematicPositionBased()
                .setTranslation(a.position.x, a.position.y, a.position.z)
                .setRotation(a.rotation),
            );
          }
          const b = m.box;
          const desc = new RAPIER.ColliderDesc(shape(m)).setTranslation(
            b.p[0] - a.origin.x,
            b.p[1] - a.origin.y,
            b.p[2] - a.origin.z,
          );
          a.active.set(m.index, this.world.createCollider(desc, a.body));
          dirty = true;
        }
      }
      if (!a.active.size) this.release(a);
      if (a.body && a.moved) {
        a.body.setTranslation(a.position, false);
        a.body.setRotation(a.rotation, false);
        dirty = true;
      }
      a.moved = false;
    }
    return dirty;
  }

  // Weapons, grapples, clearance probes and teleports can query any assembly,
  // independently of which pieces have character colliders at this instant.
  ray(o: Vector3, d: Vector3, max: number) {
    let distance = max,
      box: Box | null = null;
    const lengthSquared = d.lengthSq();
    if (!lengthSquared) return null;
    for (const a of this.assemblies.values()) {
      this.probe.copy(a.position).sub(o);
      const t = Math.min(
        distance,
        Math.max(0, this.probe.dot(d) / lengthSquared),
      );
      if (this.probe.addScaledVector(d, -t).lengthSq() > a.radius * a.radius)
        continue;
      const origin = this.local(this.from.copy(o), a).toArray();
      const direction = this.to.copy(d).applyQuaternion(a.inverse).toArray();
      for (const m of a.members.values()) {
        const hit = rayBox(origin, direction, m.box, distance);
        if (hit !== null && hit <= distance) {
          box = m.box;
          distance = hit;
        }
      }
    }
    return box
      ? {
          box,
          distance,
          point: this.probe
            .copy(o)
            .addScaledVector(d, distance)
            .toArray() as V3,
        }
      : null;
  }
  overlaps(center: Vector3, capsule: RAPIER.Capsule) {
    for (const a of this.assemblies.values()) {
      if (
        center.distanceToSquared(a.position) >
        (a.radius + capsule.halfHeight + capsule.radius) ** 2
      )
        continue;
      this.local(this.from.copy(center), a);
      this.axis.set(0, capsule.halfHeight, 0).applyQuaternion(a.inverse);
      this.axis.set(
        Math.abs(this.axis.x) + capsule.radius,
        Math.abs(this.axis.y) + capsule.radius,
        Math.abs(this.axis.z) + capsule.radius,
      );
      this.bounds.min.copy(this.from).sub(this.axis);
      this.bounds.max.copy(this.from).add(this.axis);
      for (const m of a.members.values()) {
        if (!this.bounds.intersectsBox(m.bounds)) continue;
        if (
          shape(m).intersectsShape(
            this.probe.fromArray(m.box.p),
            identity,
            capsule,
            this.from,
            a.inverse,
          )
        )
          return true;
      }
    }
    return false;
  }
}
