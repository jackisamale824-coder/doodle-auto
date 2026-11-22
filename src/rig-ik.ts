import { Object3D, Quaternion, Vector3 } from "three";
const down = new Vector3(0, -1, 0);
/** Two joint arm solve in the shoulder parent's space, with a stable elbow pole. */
export function solveArm(
  shoulder: Object3D,
  elbow: Object3D,
  target: Vector3,
  pole: Vector3,
  upper = 0.28,
  lower = 0.27,
) {
  const delta = target.clone().sub(shoulder.position),
    distance = Math.max(0.001, Math.min(upper + lower - 0.001, delta.length()));
  const axis = delta.normalize();
  const bend = pole.clone().addScaledVector(axis, -pole.dot(axis)).normalize();
  const along =
    (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const offset = axis
    .clone()
    .multiplyScalar(along)
    .addScaledVector(
      bend,
      Math.sqrt(Math.max(0, upper * upper - along * along)),
    );
  shoulder.quaternion.setFromUnitVectors(down, offset.clone().normalize());
  const forearm = axis
    .multiplyScalar(distance)
    .sub(offset)
    .normalize()
    .applyQuaternion(shoulder.quaternion.clone().invert());
  elbow.quaternion.setFromUnitVectors(down, forearm);
}
