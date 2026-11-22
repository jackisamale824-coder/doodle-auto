import * as T from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { GOLD, INK } from "./render.ts";
import type { Controller } from "./physics.ts";

/** A depth-tested cable in the world, never a weapon-overlay line. */
export class GrappleVisual extends T.Group {
  private cable = new Line2(
    new LineGeometry(),
    new LineMaterial({
      color: INK,
      linewidth: 2.2,
      alphaToCoverage: true,
      depthTest: true,
    }),
  );
  private tip = new T.Mesh(
    new T.OctahedronGeometry(0.09),
    new T.MeshBasicMaterial({ color: INK }),
  );
  private ring = new T.Mesh(
    new T.TorusGeometry(0.15, 0.025, 5, 16),
    new T.MeshBasicMaterial({ color: GOLD }),
  );
  private shot = -1;
  private age = 0;
  constructor() {
    super();
    this.add(this.cable, this.tip, this.ring);
  }
  update(player: Controller, camera: T.Camera, dt: number) {
    this.visible = !!player.anchor;
    if (!player.anchor) {
      this.shot = -1;
      return;
    }
    if (this.shot !== player.hooks) {
      this.shot = player.hooks;
      this.age = 0;
    }
    this.age += dt;
    const end = new T.Vector3(
      player.anchor.x,
      player.anchor.y,
      player.anchor.z,
    );
    // Camera-relative socket follows turns and smoothed eye height.
    const start = new T.Vector3(-0.28, -0.5, -0.32)
      .applyQuaternion(camera.quaternion)
      .add(camera.position);
    const contacts = player.ropePath.length ? player.ropePath : [end];
    const path = contacts[0].clone().sub(start),
      length = path.length();
    const socket = start.clone().sub(player.eye);
    // When near a wall, keep the visible cable on the validated physics path.
    if (
      player.physics.ray(
        player.eye,
        socket.clone().normalize(),
        socket.length(),
      ) ||
      (length > 0.08 &&
        player.physics.ray(start, path.normalize(), length - 0.08))
    )
      start.copy(player.eye);
    const progress = Math.min(1, this.age / 0.09);
    const points = [start, ...contacts];
    let total = 0;
    for (let i = 1; i < points.length; i++)
      total += points[i - 1].distanceTo(points[i]);
    let remaining = total * progress;
    const visible = [start];
    for (let i = 1; i < points.length; i++) {
      const length = points[i - 1].distanceTo(points[i]);
      if (remaining < length) {
        visible.push(points[i - 1].clone().lerp(points[i], remaining / length));
        break;
      }
      visible.push(points[i]);
      remaining -= length;
    }
    const head = visible[visible.length - 1];
    this.cable.geometry.setPositions(visible.flatMap((p) => p.toArray()));
    this.cable.computeLineDistances();
    this.tip.position.copy(head);
    this.ring.visible = progress === 1;
    this.ring.position
      .copy(end)
      .addScaledVector(start.clone().sub(end).normalize(), 0.055);
    this.ring.scale.setScalar(T.MathUtils.clamp(length / 18, 1, 4));
    this.ring.lookAt(start);
  }
}
