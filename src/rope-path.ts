import { Vector3 } from "three";
import type { Box } from "./world.ts";
export type RopeRay = (
  a: Vector3,
  d: Vector3,
  max: number,
) => { box: Box } | null;
export function ropeBlock(a: Vector3, b: Vector3, ray: RopeRay) {
  const d = b.clone().sub(a),
    length = d.length();
  return length > 0.08 ? ray(a, d.divideScalar(length), length - 0.08) : null;
}

// Visibility graph around the solid boxes encountered by the cable. Points
// stand off the edges slightly so adjacent faces cannot flicker the contact.
function detour(start: Vector3, end: Vector3, ray: RopeRay): Vector3[] | null {
  const nodes = [start, end];
  const boxes = new Set<Box>();
  let pending = [ropeBlock(start, end, ray)?.box].filter(Boolean) as Box[];
  for (let pass = 0; pass < 5; pass++) {
    for (const box of pending) {
      if (boxes.has(box) || nodes.length > 180) continue;
      boxes.add(box);
      const lo = box.p.map((p, i) => p - box.s[i] / 2 - 0.045);
      const hi = box.p.map((p, i) => p + box.s[i] / 2 + 0.045);
      // Corners plus closest-height edge contacts avoid needless roof detours.
      for (let axis = 0; axis < 3; axis++) {
        const a = (axis + 1) % 3,
          b = (axis + 2) % 3;
        for (const u of [lo[a], hi[a]])
          for (const v of [lo[b], hi[b]]) {
            for (const t of [
              lo[axis],
              hi[axis],
              Math.max(
                lo[axis],
                Math.min(
                  hi[axis],
                  (start.getComponent(axis) + end.getComponent(axis)) / 2,
                ),
              ),
            ]) {
              const point = new Vector3()
                .setComponent(axis, t)
                .setComponent(a, u)
                .setComponent(b, v);
              if (!nodes.some((n) => n.distanceToSquared(point) < 1e-8))
                nodes.push(point);
            }
          }
      }
    }
    pending = [];
    const costs = nodes.map(() => Infinity),
      prev = nodes.map(() => -1),
      seen = new Set<number>();
    costs[0] = 0;
    for (let step = 0; step < nodes.length; step++) {
      let at = -1;
      for (let i = 0; i < nodes.length; i++)
        if (!seen.has(i) && (at < 0 || costs[i] < costs[at])) at = i;
      if (at < 0 || !Number.isFinite(costs[at])) break;
      if (at === 1) {
        const path: Vector3[] = [];
        for (let i = 1; i > 0; i = prev[i]) path.unshift(nodes[i].clone());
        return path;
      }
      seen.add(at);
      for (let next = 1; next < nodes.length; next++) {
        if (seen.has(next)) continue;
        const cost = costs[at] + nodes[at].distanceTo(nodes[next]);
        if (cost >= costs[next]) continue;
        const hit = ropeBlock(nodes[at], nodes[next], ray);
        if (hit) {
          if (!boxes.has(hit.box) && !pending.includes(hit.box))
            pending.push(hit.box);
        } else {
          costs[next] = cost;
          prev[next] = at;
        }
      }
    }
    if (!pending.length) break;
  }
  return null;
}

/** Returns player-to-anchor contacts, excluding player, including anchor. */
export function routeRope(
  start: Vector3,
  end: Vector3,
  previous: Vector3[],
  ray: RopeRay,
): Vector3[] | null {
  let path = [...previous.slice(0, -1).map((p) => p.clone()), end.clone()];
  // Unwrap only when a straight shortcut is collision-free.
  for (let i = -1; i < path.length - 1; i++) {
    const from = i < 0 ? start : path[i];
    for (let j = path.length - 1; j > i + 1; j--) {
      if (!ropeBlock(from, path[j], ray)) {
        path.splice(i + 1, j - i - 1);
        break;
      }
    }
  }
  for (let i = 0; i < path.length; i++) {
    const from = i === 0 ? start : path[i - 1];
    if (!ropeBlock(from, path[i], ray)) continue;
    const around = detour(from, path[i], ray);
    if (!around || path.length + around.length > 24) return null;
    path.splice(i, 1, ...around);
    i += around.length - 1;
  }
  return path;
}
