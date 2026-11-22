import type { V3 } from "./world.ts";
export type HitRegion = "head" | "body" | "arm" | "leg";
export const HIT_MULTIPLIER: Record<HitRegion, number> = {
  head: 2.4,
  body: 1,
  arm: 0.65,
  leg: 0.75,
};
// Model-local anatomical volumes. Limb depth includes the running animation's
// travel so a visible moving arm/leg remains hittable between network ticks.
export const ACTOR_HITBOXES: { region: HitRegion; min: V3; max: V3 }[] = [
  { region: "head", min: [-0.27, 1.32, -0.25], max: [0.27, 1.84, 0.27] },
  { region: "body", min: [-0.24, 0.68, -0.19], max: [0.24, 1.32, 0.21] },
  { region: "arm", min: [-0.39, 0.65, -0.34], max: [-0.24, 1.32, 0.43] },
  { region: "arm", min: [0.24, 0.65, -0.34], max: [0.39, 1.32, 0.43] },
  { region: "leg", min: [-0.23, 0.04, -0.36], max: [-0.01, 0.7, 0.39] },
  { region: "leg", min: [0.01, 0.04, -0.36], max: [0.23, 0.7, 0.39] },
];
export function actorHit(
  origin: V3,
  dir: V3,
  feet: V3,
  height: number,
  limit: number,
  modelYaw = 0,
  lean = 0,
) {
  const scale = height / 1.76,
    c = Math.cos(modelYaw),
    s = Math.sin(modelYaw);
  const dx = origin[0] - feet[0],
    dz = origin[2] - feet[2];
  const localOrigin = [
    c * dx - s * dz,
    (origin[1] - feet[1]) / scale,
    s * dx + c * dz,
  ];
  const localDir = [
    c * dir[0] - s * dir[2],
    dir[1] / scale,
    s * dir[0] + c * dir[2],
  ];
  let result: {
    distance: number;
    head: boolean;
    region: HitRegion;
    multiplier: number;
    side: number;
  } | null = null;
  for (const box of ACTOR_HITBOXES) {
    let enter = 0,
      leave = limit;
    for (let i = 0; i < 3; i++) {
      const o = localOrigin[i] + (i === 0 && box.region !== "leg" ? lean : 0),
        d = localDir[i];
      if (Math.abs(d) < 1e-8) {
        if (o < box.min[i] || o > box.max[i]) {
          leave = -1;
          break;
        }
      } else {
        const a = (box.min[i] - o) / d,
          b = (box.max[i] - o) / d;
        enter = Math.max(enter, Math.min(a, b));
        leave = Math.min(leave, Math.max(a, b));
      }
    }
    if (leave >= enter && enter < limit && (!result || enter < result.distance))
      result = {
        distance: enter,
        head: box.region === "head",
        region: box.region,
        multiplier: HIT_MULTIPLIER[box.region],
        side: localOrigin[0] + lean + localDir[0] * enter < 0 ? -1 : 1,
      };
  }
  return result;
}
export function movementYaw(dx: number, dz: number, fallback: number) {
  return Math.hypot(dx, dz) > 0.001 ? Math.atan2(-dx, -dz) : fallback;
}
