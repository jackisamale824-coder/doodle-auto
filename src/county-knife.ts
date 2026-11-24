import * as T from "three";
import { PUNCHES } from "./fists.ts";

export const KNIFE_DAMAGE = 100;
export function knifePose(move: number, age: number, side: number) {
  const timing = PUNCHES[move];
  const swing =
    T.MathUtils.smoothstep(age, 0, timing.contact) *
    (1 - T.MathUtils.smoothstep(age, timing.contact, timing.duration));
  if (side < 0)
    return {
      x: -0.025 * swing,
      y: -0.02 * swing,
      z: -0.035 * swing,
      roll: -0.12 * swing,
      twist: 0,
    };
  const direction = move === 1 ? 1 : -1;
  return {
    x: direction * 0.24 * swing,
    y: 0.08 * swing,
    z: (move === 2 ? 0.38 : 0.24) * swing,
    roll: direction * 0.95 * swing,
    twist: direction * 0.2 * swing,
  };
}
export function buildKnife() {
  const knife = new T.Group();
  knife.name = "tideglass-knife";
  const handle = new T.Mesh(
    new T.CylinderGeometry(0.021, 0.025, 0.13, 7),
    new T.MeshBasicMaterial({ color: 0x164d55 }),
  );
  knife.add(handle);
  const outline = new T.Shape();
  outline.moveTo(-0.022, 0.057);
  outline.lineTo(0.027, 0.057);
  outline.quadraticCurveTo(0.045, 0.205, 0.006, 0.302);
  outline.quadraticCurveTo(-0.024, 0.23, -0.022, 0.057);
  const blade = new T.Mesh(
    new T.ExtrudeGeometry(outline, {
      depth: 0.009,
      bevelThickness: 0.002,
      bevelSize: 0.003,
      bevelSegments: 1,
      steps: 1,
    }),
    [
      new T.MeshBasicMaterial({ color: 0x477b90 }),
      new T.MeshBasicMaterial({ color: 0xb2ccda }),
    ],
  );
  knife.add(blade);
  const guard = new T.Mesh(
    new T.BoxGeometry(0.084, 0.015, 0.038),
    new T.MeshBasicMaterial({ color: 0xe8bb65 }),
  );
  guard.position.y = 0.057;
  knife.add(guard);
  return knife;
}
