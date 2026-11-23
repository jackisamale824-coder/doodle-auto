import * as T from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { punchPose } from "./fists.ts";
import { inkMaterial, INK } from "./render.ts";

export function buildFists() {
  const group = new T.Group();
  group.name = "fists";
  const paper = inkMaterial(INK, 0.05, true),
    blue = inkMaterial(INK, 0.45, true);
  const sphere = new T.SphereGeometry(1, 16, 12);
  for (const side of [-1, 1]) {
    const hand = new T.Group();
    function oval(
      parent: T.Object3D,
      mat: T.Material,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
    ) {
      const mesh = new T.Mesh(sphere, mat);
      mesh.position.set(x, y, z);
      mesh.scale.set(w, h, d);
      parent.add(mesh);
      return mesh;
    }
    const palm = new T.Mesh(
      new RoundedBoxGeometry(0.128, 0.092, 0.147, 3, 0.029),
      paper,
    );
    palm.rotation.z = side * 0.08;
    hand.add(palm);
    for (let i = 0; i < 4; i++)
      oval(
        hand,
        paper,
        side * (i - 1.5) * 0.032,
        0.045 - i * 0.004,
        -0.053 + i * 0.009,
        0.022,
        0.031 - i * 0.002,
        0.05,
      );
    oval(
      hand,
      paper,
      -side * 0.057,
      0.014,
      -0.005,
      0.031,
      0.035,
      0.056,
    ).rotation.y = side * 0.34;
    const sleeve = oval(group, blue, 0, 0, 0, 1, 1, 1);
    const cuff = oval(group, paper, 0, 0, 0, 1, 1, 1);
    hand.name = side === -1 ? "left-fist" : "right-fist";
    group.add(hand);
    hand.userData.sleeve = sleeve;
    hand.userData.cuff = cuff;
  }
  return group;
}
const wrist = new T.Vector3(),
  elbow = new T.Vector3(),
  axis = new T.Vector3(),
  up = new T.Vector3(0, 1, 0);
export function animateFists(
  group: T.Group,
  move: number,
  age: number,
  time: number,
) {
  for (const side of [-1, 1]) {
    const hand = group.getObjectByName(
      side === -1 ? "left-fist" : "right-fist",
    )!;
    const pose = punchPose(move, age, side);
    wrist.set(
      side * 0.215 + pose.x,
      -0.17 + pose.y + 0.006 * Math.sin(time * 2.5 + side * 0.4),
      -0.43 - pose.z,
    );
    hand.position.copy(wrist);
    hand.rotation.set(
      0.29 - pose.z * 0.7,
      -side * 0.2,
      side * 0.54 + pose.roll,
    );
    elbow.set(
      side * 0.31 + pose.x * 0.45,
      -0.42 + pose.y * 0.4,
      -0.14 - pose.z * 0.9,
    );
    axis.subVectors(wrist, elbow);
    const length = axis.length();
    axis.normalize();
    const { sleeve, cuff } = hand.userData;
    sleeve.position.lerpVectors(elbow, wrist, 0.4);
    sleeve.quaternion.setFromUnitVectors(up, axis);
    sleeve.scale.set(0.062, length * 0.6, 0.06);
    cuff.position.copy(wrist).addScaledVector(axis, -0.08);
    cuff.quaternion.copy(sleeve.quaternion);
    cuff.scale.set(0.061, 0.029, 0.058);
  }
}
