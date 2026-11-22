import { Mesh, Vector3, type Scene, type Material } from "three";
import { GOLD, stroke } from "./render.ts";
export class ShotTrails {
  pending: Vector3[] = [];
  active: { from: Vector3; to: Vector3; age: number; mesh: Mesh }[] = [];
  constructor(private scene: Scene) {}
  queue(to: Vector3) {
    if (this.pending.length < 64) this.pending.push(to.clone());
  }
  render(dt: number, muzzle: () => Vector3) {
    // Sample only after camera, bob, sway, recoil and reload have been posed.
    if (this.pending.length) {
      const from = muzzle();
      for (const to of this.pending) {
        const mesh = stroke(new Vector3(), new Vector3(0, 1, 0), GOLD, 0.012);
        this.scene.add(mesh);
        this.active.push({ from: from.clone(), to, age: 0, mesh });
      }
      this.pending = [];
    }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const shot = this.active[i],
        direction = shot.to.clone().sub(shot.from),
        distance = direction.length();
      const tail = shot.age * 1800;
      if (tail >= distance || distance < 0.01) {
        this.remove(i);
        continue;
      }
      direction.divideScalar(distance);
      const head = Math.min(distance, tail + 14);
      shot.mesh.position
        .copy(shot.from)
        .addScaledVector(direction, (tail + head) / 2);
      shot.mesh.scale.y = head - tail;
      shot.mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction);
      shot.age += dt;
    }
  }
  private remove(i: number) {
    const { mesh } = this.active[i];
    mesh.removeFromParent();
    mesh.geometry.dispose();
    (mesh.material as Material).dispose();
    this.active.splice(i, 1);
  }
  dispose() {
    this.pending = [];
    while (this.active.length) this.remove(this.active.length - 1);
  }
}
