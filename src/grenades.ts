import { FLASH, FRAG, ROCKET, SMOKE, WEAPONS } from "./weapon-balance.ts";
import { distance, type V3 } from "./world.ts";
import { actorHit } from "./actor-hit.ts";

type Ray = (
  origin: V3,
  direction: V3,
  length: number,
) => { distance: number } | null | undefined;
export interface GrenadeEffect {
  weapon: number;
  p: V3;
  expires: number;
  flight?: {
    path: V3[];
    start: number;
    arrival: number;
    impact: number;
    owner: string;
    resolved?: boolean;
  };
}
export const blastRadius = (id: number) => (id === FRAG ? 4.5 : 5.5);
export interface BlastTarget {
  p: V3;
  hp: number;
  height: number;
  yaw: number;
}
export function projectileRay(ray: Ray, targets: BlastTarget[]): Ray {
  return (origin, dir, max) => {
    let closest = ray(origin, dir, max);
    for (const target of targets) {
      if (target.hp <= 0) continue;
      const hit = actorHit(
        origin,
        dir,
        target.p,
        target.height,
        closest?.distance ?? max,
        target.yaw + Math.PI,
      );
      if (hit) closest = hit;
    }
    return closest;
  };
}
export function contactDirection(effect: GrenadeEffect): V3 {
  const path = effect.flight!.path,
    previous = path[path.length - 2],
    length = distance(previous, effect.p) || 1;
  return effect.p.map((v, i) => (v - previous[i]) / length) as V3;
}

/** Both hosts use the same arcade arc, collision samples, and impact clock. */
export function launchBlast(
  weapon: number,
  eye: V3,
  dir: V3,
  ray: Ray,
  now: number,
  owner: string,
): GrenadeEffect {
  const rocket = weapon === ROCKET,
    steps = rocket ? 1 : 16,
    range = rocket ? 75 : 14;
  const path: V3[] = [[...eye]];
  let fraction = 1;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps,
      previous = path[path.length - 1];
    const next = eye.map((v, k) => v + dir[k] * range * t) as V3;
    if (!rocket) next[1] += 7 * t * (1 - t) - 4 * t * t;
    const length = distance(previous, next);
    const direction = next.map((v, k) => (v - previous[k]) / length) as V3;
    const hit = ray(previous, direction, length);
    if (hit && hit.distance <= length) {
      const reach = Math.max(0, hit.distance - 0.08);
      path.push(previous.map((v, k) => v + direction[k] * reach) as V3);
      fraction = (i - 1 + reach / length) / steps;
      break;
    }
    path.push(next);
  }
  const arrival = now + Math.max(75, (rocket ? 1150 : 850) * fraction);
  const impact = arrival + (rocket ? 0 : 450);
  return {
    weapon,
    p: path[path.length - 1],
    expires: impact + 380,
    flight: { path, start: now, arrival, impact, owner },
  };
}

export function blastDamage(
  effect: GrenadeEffect,
  feet: V3,
  height: number,
  ray: Ray,
) {
  const center: V3 = [feet[0], feet[1] + height * 0.5, feet[2]];
  const d = distance(effect.p, center),
    radius = blastRadius(effect.weapon);
  if (d >= radius) return 0;
  if (d > 0.1) {
    const dir = center.map((v, k) => (v - effect.p[k]) / d) as V3;
    if (ray(effect.p, dir, d - 0.05)) return 0;
  }
  return Math.round(WEAPONS[effect.weapon].damage * (1 - (0.8 * d) / radius));
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
    if (e.weapon !== SMOKE) return false;
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
