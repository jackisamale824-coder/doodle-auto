import { FLASH, SMOKE } from "./weapon-balance.ts";
import { distance, type V3 } from "./world.ts";

type Ray = (
  origin: V3,
  direction: V3,
  length: number,
) => { distance: number } | null | undefined;
export interface GrenadeEffect {
  weapon: number;
  p: V3;
  expires: number;
}
export const SMOKE_RADIUS = 4;
export function throwGrenade(
  weapon: number,
  eye: V3,
  dir: V3,
  ray: Ray,
  now: number,
): GrenadeEffect {
  const reach = Math.max(
    0,
    Math.min(12, (ray(eye, dir, 12)?.distance ?? 12) - 0.2),
  );
  const p = eye.map((v, i) => v + dir[i] * reach) as V3;
  const ground = ray(p, [0, -1, 0], 12);
  if (ground) p[1] += 0.55 - ground.distance;
  return { weapon, p, expires: now + (weapon === SMOKE ? 7000 : 1600) };
}
export function obscured(
  effects: GrenadeEffect[],
  from: V3,
  to: V3,
  now: number,
) {
  return effects.some((e) => {
    if (e.expires <= now) return false;
    if (e.weapon === FLASH) return distance(from, e.p) < 7;
    const dx = to[0] - from[0],
      dy = to[1] - from[1],
      dz = to[2] - from[2];
    const along = Math.max(
      0,
      Math.min(
        1,
        ((e.p[0] - from[0]) * dx +
          (e.p[1] - from[1]) * dy +
          (e.p[2] - from[2]) * dz) /
          (dx * dx + dy * dy + dz * dz || 1),
      ),
    );
    return (
      Math.hypot(
        from[0] + along * dx - e.p[0],
        from[1] + along * dy - e.p[1],
        from[2] + along * dz - e.p[2],
      ) < SMOKE_RADIUS
    );
  });
}
