import * as T from "three";
import {
  inkMaterial,
  INK,
  RED,
  stroke,
  outlinedBox,
  label,
  disposeGroup,
} from "./render.ts";
export class Doodle {
  group = new T.Group();
  head = new T.Group();
  leftArm = new T.Group();
  rightArm = new T.Group();
  leftLeg = new T.Group();
  rightLeg = new T.Group();
  nameLabel: T.Mesh | null = null;
  flashTime = 0;
  constructor(
    public color = RED,
    name?: string,
  ) {
    const mat = inkMaterial(color, 0.035),
      solid = new T.MeshBasicMaterial({ color });
    const torso = new T.Mesh(new T.SphereGeometry(1, 10, 8), mat);
    torso.scale.set(0.24, 0.4, 0.15);
    torso.position.y = 0.95;
    this.group.add(torso);
    const head = new T.Mesh(new T.SphereGeometry(0.28, 12, 10), mat);
    this.head.add(head);
    const outline = new T.LineSegments(
      new T.EdgesGeometry(head.geometry, 16),
      new T.LineBasicMaterial({ color, transparent: true, opacity: 0.38 }),
    );
    head.add(outline);
    for (const x of [-0.095, 0.095]) {
      const eye = new T.Mesh(new T.SphereGeometry(0.035, 6, 5), solid);
      eye.position.set(x, 0.025, 0.255);
      this.head.add(eye);
      this.head.add(
        stroke(
          new T.Vector3(x - 0.045, 0.13, 0.24),
          new T.Vector3(x + 0.045, 0.11, 0.24),
          color,
          0.018,
        ),
      );
    }
    const mouth = new T.Line(
      new T.BufferGeometry().setFromPoints([
        new T.Vector3(-0.075, -0.1, 0.25),
        new T.Vector3(0, -0.13, 0.265),
        new T.Vector3(0.075, -0.1, 0.25),
      ]),
      new T.LineBasicMaterial({ color }),
    );
    this.head.add(mouth);
    this.head.position.y = 1.55;
    this.group.add(this.head);
    for (const [part, x, y, length] of [
      [this.leftArm, -0.26, 1.23, 0.57],
      [this.rightArm, 0.26, 1.23, 0.57],
      [this.leftLeg, -0.13, 0.66, 0.61],
      [this.rightLeg, 0.13, 0.66, 0.61],
    ] as const) {
      part.position.set(x, y, 0);
      part.add(
        stroke(
          new T.Vector3(),
          new T.Vector3(x * 0.2, -length, 0.02),
          color,
          0.04,
        ),
      );
      const mitten = new T.Mesh(new T.SphereGeometry(0.075, 6, 5), mat);
      mitten.position.set(x * 0.2, -length, 0.035);
      part.add(mitten);
      this.group.add(part);
    }
    const gun = new T.Group();
    outlinedBox([0.09, 0.11, 0.42], [0, -0.5, 0.16], mat, gun, color);
    this.rightArm.add(gun);
    const headband = new T.Mesh(
      new T.TorusGeometry(0.275, 0.022, 4, 16),
      solid,
    );
    headband.rotation.x = Math.PI / 2;
    headband.position.y = 0.12;
    this.head.add(headband);
    if (name) {
      this.nameLabel = label(name, 256, color);
      this.nameLabel.scale.set(0.8, 0.8, 0.8);
      this.nameLabel.position.y = 2.2;
      this.group.add(this.nameLabel);
    }
  }
  animate(t: number, speed: number, camera: T.Camera) {
    const swing = Math.sin(t * 10) * Math.min(speed / 5, 1) * 0.55;
    this.leftLeg.rotation.x = swing;
    this.rightLeg.rotation.x = -swing;
    this.leftArm.rotation.x = -swing;
    this.rightArm.rotation.x = -0.85 + swing * 0.25;
    this.head.rotation.z = Math.sin(t * 2) * 0.035;
    if (this.nameLabel) this.nameLabel.quaternion.copy(camera.quaternion);
    this.group.scale.setScalar(this.flashTime > t ? 1.12 : 1);
  }
  dispose() {
    disposeGroup(this.group);
  }
}
export function buildWeapon(index: number) {
  const g = new T.Group(),
    mat = inkMaterial(INK, 0.05),
    dark = inkMaterial(INK, 0.65);
  if (index === 0) {
    outlinedBox([0.12, 0.16, 0.5], [0, 0, 0], mat, g);
    outlinedBox([0.075, 0.075, 0.4], [0, 0.025, -0.4], dark, g);
    outlinedBox([0.07, 0.2, 0.12], [0, -0.15, 0.07], mat, g);
    outlinedBox([0.085, 0.22, 0.11], [0, -0.17, -0.08], dark, g);
    outlinedBox([0.15, 0.2, 0.24], [0, -0.03, 0.35], mat, g);
    outlinedBox([0.035, 0.06, 0.025], [0, 0.13, -0.18], dark, g);
  } else if (index === 1) {
    outlinedBox([0.17, 0.16, 0.62], [0, 0, -0.03], mat, g);
    for (const x of [-0.05, 0.05]) {
      const barrel = new T.Mesh(
        new T.CylinderGeometry(0.035, 0.035, 0.55, 8),
        dark,
      );
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(x, 0.02, -0.53);
      g.add(barrel);
    }
    outlinedBox([0.2, 0.12, 0.18], [0, -0.07, -0.32], mat, g);
    outlinedBox([0.12, 0.24, 0.27], [0, -0.02, 0.35], mat, g);
  } else {
    outlinedBox([0.09, 0.12, 0.31], [0, 0, -0.08], mat, g);
    outlinedBox([0.08, 0.21, 0.11], [0, -0.15, 0.06], dark, g);
  }
  for (const x of [-0.1, 0.05]) {
    const arm = new T.Mesh(new T.CylinderGeometry(0.07, 0.08, 0.4, 7), mat);
    arm.rotation.x = 0.8;
    arm.position.set(x, -0.28, 0.29);
    g.add(arm);
    const hand = new T.Mesh(new T.SphereGeometry(0.075, 8, 6), mat);
    hand.position.set(x, -0.1, 0.14);
    g.add(hand);
  }
  return g;
}
