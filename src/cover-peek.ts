import type { V3 } from "./world.ts";
export type CoverRay = (
  o: V3,
  d: V3,
  max: number,
) => { distance: number } | null;
export const PEEK_DISTANCE = 0.5;
export function peekEye(eye: V3, yaw: number, lean: number): V3 {
  return [eye[0] + Math.cos(yaw) * lean, eye[1], eye[2] - Math.sin(yaw) * lean];
}
export function coverSide(
  eye: V3,
  yaw: number,
  pitch: number,
  ray: CoverRay,
  preferred = 1,
) {
  const forward: V3 = [
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch),
  ];
  // Only engage at actual nearby cover, not free-standing in the open.
  if (!ray(eye, forward, 1.5)) return 0;
  for (const side of [preferred < 0 ? -1 : 1, preferred < 0 ? 1 : -1]) {
    const lateral: V3 = [Math.cos(yaw) * side, 0, -Math.sin(yaw) * side];
    let clear = true;
    for (const h of [-0.12, 0, 0.12]) {
      const start: V3 = [eye[0], eye[1] + h, eye[2]];
      if (ray(start, lateral, PEEK_DISTANCE + 0.12)) {
        clear = false;
        break;
      }
      const end = peekEye(start, yaw, side * PEEK_DISTANCE);
      // Keep clearance on the inner edge of the head as well as the centre.
      const inner = peekEye(end, yaw, -side * 0.1);
      if (ray(end, forward, 1.7) || ray(inner, forward, 1.7)) {
        clear = false;
        break;
      }
    }
    if (clear) return side;
  }
  return 0;
}
export function validatedLean(
  eye: V3,
  yaw: number,
  pitch: number,
  requested: number,
  ray: CoverRay,
) {
  if (
    !Number.isFinite(requested) ||
    Math.abs(requested) > PEEK_DISTANCE + 0.001
  )
    return 0;
  if (Math.abs(requested) < 0.0001) return 0;
  const side = coverSide(eye, yaw, pitch, ray, Math.sign(requested));
  return side === Math.sign(requested) ? requested : 0;
}
export class CoverPeek {
  lean = 0;
  update(
    dt: number,
    eye: V3,
    yaw: number,
    pitch: number,
    aiming: boolean,
    ray: CoverRay,
  ) {
    const side = aiming
      ? coverSide(eye, yaw, pitch, ray, Math.sign(this.lean) || 1)
      : 0;
    const target = side * PEEK_DISTANCE;
    this.lean +=
      (target - this.lean) *
      (1 - Math.exp(-Math.min(0.1, Math.max(0, dt)) * 18));
    // Movement may put a wall beside the player: never ease the camera through it.
    if (this.lean) {
      const d: V3 = [
        Math.cos(yaw) * Math.sign(this.lean),
        0,
        -Math.sin(yaw) * Math.sign(this.lean),
      ];
      const hit = ray(eye, d, Math.abs(this.lean) + 0.12);
      if (hit)
        this.lean = Math.sign(this.lean) * Math.max(0, hit.distance - 0.12);
    }
    return this.lean;
  }
}
