import { Quaternion, Vector3 } from "three";
export type ClearanceRay = (
  origin: Vector3,
  direction: Vector3,
  max: number,
) => { distance: number } | null;
/** Probe the unraised weapon corridor so the avoidance pose cannot oscillate. */
export class WeaponClearance {
  weight = 0;
  update(
    dt: number,
    eye: Vector3,
    rotation: Quaternion,
    weapon: number,
    ads: number,
    ray: ClearanceRay,
  ) {
    const reach = [1.4, 1.38, 0.78, 1.65][weapon] ?? 1.4;
    const forward = new Vector3(0, 0, -1).applyQuaternion(rotation);
    const x = 0.3 * (1 - ads),
      y = -0.2 * (1 - ads);
    let nearest = reach + 0.12;
    // Centre plus the edges of the barrel/receiver corridor catch narrow props
    // and corners without reacting to the player's own collider.
    for (const [dx, dy] of [
      [0, 0],
      [-0.1, 0],
      [0.1, 0],
      [0, -0.12],
      [0, 0.12],
    ]) {
      const origin = new Vector3(x + dx, y + dy, 0)
        .applyQuaternion(rotation)
        .add(eye);
      const hit = ray(origin, forward, reach + 0.12);
      if (hit) nearest = Math.min(nearest, hit.distance);
    }
    const target = Math.max(
      0,
      Math.min(1, (reach + 0.12 - nearest) / (reach - 0.25)),
    );
    this.weight +=
      (target - this.weight) *
      (1 -
        Math.exp(
          -Math.max(0, Math.min(dt, 0.1)) * (target > this.weight ? 32 : 14),
        ));
    return {
      pitch: this.weight * 1.35,
      retract: this.weight * 0.62,
      lower: this.weight * 0.06,
    };
  }
}
