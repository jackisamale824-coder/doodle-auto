import * as T from "three";
import { handMesh } from "./hand-model.ts";
import type { reloadPose } from "./weapon-motion.ts";

export function countyHand(side: number) {
  const hand = handMesh(
    side,
    new T.MeshBasicMaterial({ vertexColors: true }),
    true,
  );
  const pos = hand.geometry.getAttribute("position");
  const normals = hand.geometry.getAttribute("normal");
  const colors: number[] = [],
    color = new T.Color();
  for (let i = 0; i < pos.count; i++) {
    const fingertip = pos.getY(i) < -0.021 && pos.getZ(i) < 0.032;
    color
      .set(fingertip ? 0xcf9876 : 0x354a55)
      .multiplyScalar(0.79 + 0.21 * Math.max(0, normals.getY(i)));
    colors.push(color.r, color.g, color.b);
  }
  hand.geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  for (const fold of hand.children)
    ((fold as T.Mesh).material as T.MeshBasicMaterial).color.setHex(0x344651);
  return hand;
}

export function addCountyArms(gun: T.Group, weapon: number) {
  const cloth = new T.MeshBasicMaterial({ color: 0x386673 });
  const sleeveShape = new T.CylinderGeometry(0.062, 0.086, 1, 12);
  const arms = [-1, 1].map((side) => {
    const hand = countyHand(side);
    const support = side < 0;
    const z = support ? [-0.39, -0.41, -0.025, -0.4][weapon] : 0.018;
    hand.position.set(
      side * 0.045,
      support && weapon !== 2 ? -0.066 : -0.105,
      z,
    );
    hand.rotation.set(support ? -0.65 : 0.42, side * 0.36, side * 0.89);
    const sleeve = new T.Mesh(sleeveShape, cloth);
    gun.add(hand, sleeve);
    return {
      hand,
      sleeve,
      rest: hand.position.clone(),
      elbow: new T.Vector3(side * 0.32, -0.38, 0.35),
    };
  });
  gun.name = "county-weapon";
  const target = new T.Vector3(),
    axis = new T.Vector3();
  return (pose: ReturnType<typeof reloadPose>, progress: number) => {
    for (const [i, arm] of arms.entries()) {
      const { hand, sleeve, rest, elbow } = arm;
      hand.position.copy(rest);
      if (i === 0) {
        const action = gun.getObjectByName("action");
        const magazine = gun.getObjectByName(
          weapon === 1 ? "shell" : "magazine",
        );
        if (magazine && progress > 0) {
          target.copy(magazine.position).x -= 0.045;
          hand.position.lerp(
            target,
            Math.min(1, pose.magazine * 1.6 + pose.shell),
          );
        }
        if (action) {
          target.copy(action.position).x -= 0.048;
          hand.position.lerp(target, weapon === 1 && !progress ? 1 : pose.rack);
        }
      }
      axis.subVectors(hand.position, elbow);
      sleeve.scale.y = axis.length();
      sleeve.position.lerpVectors(elbow, hand.position, 0.5);
      sleeve.quaternion.setFromUnitVectors(
        T.Object3D.DEFAULT_UP,
        axis.normalize(),
      );
    }
  };
}
