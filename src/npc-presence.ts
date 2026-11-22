import { distance, type V3 } from "./world.ts";
export const NPC_RADIUS = 100;
export const SPAWN_MIN = 20,
  SPAWN_MAX = 60;
export interface Observer {
  p: V3;
  eye: V3;
}
export function outsideNpcRadius(p: V3, observers: Observer[]) {
  return !observers.some((o) => distance(p, o.p) <= NPC_RADIUS);
}
// Require cover over the full silhouette, not merely a hidden foot position.
export function hiddenNpcSpawn(
  p: V3,
  observers: Observer[],
  blocked: (eye: V3, to: V3) => boolean,
) {
  if (
    !observers.length ||
    !observers.some((o) => distance(p, o.p) <= SPAWN_MAX)
  )
    return false;
  for (const o of observers) {
    const d = distance(p, o.p);
    if (d < SPAWN_MIN) return false;
    if (d > NPC_RADIUS) continue;
    for (const h of [0.25, 0.95, 1.85])
      for (const side of [-0.3, 0, 0.3]) {
        const dx = p[0] - o.eye[0],
          dz = p[2] - o.eye[2],
          len = Math.max(0.001, Math.hypot(dx, dz));
        const to: V3 = [
          p[0] + (dz / len) * side,
          p[1] + h,
          p[2] - (dx / len) * side,
        ];
        if (!blocked(o.eye, to)) return false;
      }
  }
  return true;
}
export function chooseNpcSpawn(
  nodes: V3[],
  indices: number[],
  observers: Observer[],
  occupied: V3[],
  offset: number,
  blocked: (eye: V3, to: V3) => boolean,
  clear: (p: V3) => boolean,
) {
  if (!observers.length) return null;
  const near = observers[offset % observers.length].p;
  const pool = indices.filter(
    (i) =>
      distance(nodes[i], near) >= SPAWN_MIN &&
      distance(nodes[i], near) <= SPAWN_MAX,
  );
  for (let j = 0; j < Math.min(96, pool.length); j++) {
    const node = pool[(j + offset) % pool.length],
      p = nodes[node];
    if (occupied.some((o) => distance(p, o) < 3) || !clear(p)) continue;
    if (hiddenNpcSpawn(p, observers, blocked)) return node;
  }
  return null;
}
