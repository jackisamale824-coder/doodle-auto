import { countyHand } from "./county-hands.ts";
import { buildKnife, knifePose } from "./county-knife.ts";
import { mountWeaponModel } from "./weapon-models.ts";
import { KNIFE } from "./weapon-balance.ts";
import * as T from "three";
import { handMesh } from "./hand-model.ts";
import { guardRaise, punchPose } from "./fists.ts";
import { inkMaterial, INK } from "./render.ts";

export function buildFists(knifeEquipped = false) {
  const group = new T.Group();
  group.name = knifeEquipped ? "knife-view" : "fists";
  const paper = inkMaterial(INK, 0.05, true),
    blue = inkMaterial(INK, 0.45, true);
  const sphere = new T.SphereGeometry(1, 16, 12);
  for (const side of [-1, 1]) {
    const hand = new T.Group();
    hand.add(knifeEquipped ? countyHand(side) : handMesh(side, paper, true));
    if (knifeEquipped && side === 1) {
      const knife = buildKnife();
      mountWeaponModel(knife, KNIFE, "hand");
      knife.rotation.set(-0.92, 0.35, 0.65);
      hand.add(knife);
    }
    const sleeve = new T.Mesh(
      sphere,
      knifeEquipped ? new T.MeshBasicMaterial({ color: 0x386673 }) : blue,
    );
    const cuff = new T.Mesh(
      sphere,
      knifeEquipped ? new T.MeshBasicMaterial({ color: 0x334851 }) : paper,
    );
    group.add(sleeve, cuff);
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
  equipAge: number,
) {
  for (const side of [-1, 1]) {
    const hand = group.getObjectByName(
      side === -1 ? "left-fist" : "right-fist",
    )!;
    const pose =
      group.name === "knife-view"
        ? knifePose(move, age, side)
        : punchPose(move, age, side);
    const lowered = 1 - guardRaise(equipAge, side, move, age);
    wrist.set(
      side * (0.215 + lowered * 0.09) + pose.x,
      -0.17 -
        lowered * 0.4 +
        pose.y +
        0.006 * Math.sin(time * 2.5 + side * 0.4),
      -0.43 + lowered * 0.16 - pose.z,
    );
    if (group.name === "knife-view") {
      wrist.x += side * 0.04;
      wrist.y -= 0.055;
      wrist.z -= 0.035;
    }
    hand.position.copy(wrist);
    hand.rotation.set(
      0.29 + lowered * 0.74 - pose.z * 0.7,
      -side * 0.2,
      side * (0.54 - lowered * 0.55) + pose.roll,
    );
    elbow.set(
      side * 0.31 + pose.x * 0.45,
      -0.42 - lowered * 0.16 + pose.y * 0.4,
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
