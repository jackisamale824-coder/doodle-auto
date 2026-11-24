import * as T from "three";
import type { Physics } from "./physics.ts";

// Casing positions are cosmetic. Keep a fixed pool and stop querying the world once a casing settles.
export class CountyCasings {
  private slots = Array.from({ length: 48 }, () => ({
    pos: new T.Vector3(),
    velocity: new T.Vector3(),
    angle: new T.Euler(),
    life: 0,
    shotgun: false,
    resting: false,
  }));
  private next = 0;
  private batches: T.InstancedMesh[];
  private pose = new T.Object3D();
  private direction = new T.Vector3();
  constructor(
    group: T.Group,
    private physics: Pick<Physics, "ray">,
  ) {
    this.batches = [false, true].map((shell) => {
      const mesh = new T.InstancedMesh(
        new T.CylinderGeometry(
          shell ? 0.011 : 0.006,
          shell ? 0.011 : 0.006,
          shell ? 0.055 : 0.032,
          8,
        ),
        new T.MeshBasicMaterial({ color: shell ? 0xb34439 : 0xc39646 }),
        this.slots.length,
      );
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.name = shell ? "spent-shotgun-shells" : "spent-brass-casings";
      group.add(mesh);
      return mesh;
    });
  }
  eject(weapon: number, port: T.Vector3, yaw: number, motion: T.Vector3) {
    const s = this.slots[this.next++ % this.slots.length];
    s.pos.copy(port);
    s.velocity
      .set(
        1.5 + Math.random(),
        0.9 + Math.random(),
        0.45 + Math.random() * 0.35,
      )
      .applyAxisAngle(T.Object3D.DEFAULT_UP, yaw)
      .addScaledVector(motion, 0.65);
    s.angle.set(0.2, Math.random() * 6, 0.7);
    s.life = 6;
    s.resting = false;
    s.shotgun = weapon === 1;
  }
  update(dt: number) {
    const counts = [0, 0];
    for (const s of this.slots) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (!s.resting) {
        s.velocity.y -= 9.8 * dt;
        const travel = s.velocity.length() * dt;
        this.direction.copy(s.velocity).normalize();
        const hit =
          travel > 0 && this.physics.ray(s.pos, this.direction, travel + 0.012);
        if (hit) {
          const normal = hit.normal
            ? new T.Vector3(hit.normal.x, hit.normal.y, hit.normal.z)
            : this.direction.clone().negate();
          s.pos
            .addScaledVector(this.direction, Math.max(0, hit.distance - 0.012))
            .addScaledVector(normal, 0.002);
          s.velocity.reflect(normal).multiplyScalar(0.38);
          if (normal.y > 0.55 && s.velocity.lengthSq() < 0.65) {
            s.resting = true;
            s.angle.z = Math.PI / 2;
          }
        } else s.pos.addScaledVector(s.velocity, dt);
        if (!s.resting) s.angle.z += 12 * dt;
      }
      this.pose.position.copy(s.pos);
      this.pose.rotation.copy(s.angle);
      this.pose.updateMatrix();
      const tier = Number(s.shotgun);
      this.batches[tier].setMatrixAt(counts[tier]++, this.pose.matrix);
    }
    this.batches.forEach((mesh, i) => {
      mesh.count = counts[i];
      if (counts[i]) mesh.instanceMatrix.needsUpdate = true;
    });
  }
}
