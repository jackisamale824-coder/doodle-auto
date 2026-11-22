import type { V3 } from "./world.ts";
export interface TriangleMesh {
  vertices: number[];
  indices: number[];
}
interface Node {
  lo: number[];
  hi: number[];
  left?: Node;
  right?: Node;
  triangles?: number[];
}
const cache = new WeakMap<TriangleMesh, Node>();
function tree(m: TriangleMesh, ids: number[]): Node {
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const t of ids)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) {
        const v = m.vertices[m.indices[t * 3 + j] * 3 + k];
        lo[k] = Math.min(lo[k], v);
        hi[k] = Math.max(hi[k], v);
      }
  if (ids.length <= 12) return { lo, hi, triangles: ids };
  const axis = hi
    .map((x, i) => x - lo[i])
    .reduce((a, _, i, v) => (v[i] > v[a] ? i : a), 0);
  const center = (t: number) =>
    [0, 1, 2].reduce(
      (v, j) => v + m.vertices[m.indices[t * 3 + j] * 3 + axis],
      0,
    );
  ids.sort((a, b) => center(a) - center(b));
  const mid = ids.length >> 1;
  return {
    lo,
    hi,
    left: tree(m, ids.slice(0, mid)),
    right: tree(m, ids.slice(mid)),
  };
}
function triangle(m: TriangleMesh, t: number, o: V3, d: V3): number | null {
  const { vertices: v, indices: ix } = m,
    a = ix[t * 3] * 3,
    b = ix[t * 3 + 1] * 3,
    c = ix[t * 3 + 2] * 3;
  const e1 = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]],
    e2 = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]];
  const p = [
    d[1] * e2[2] - d[2] * e2[1],
    d[2] * e2[0] - d[0] * e2[2],
    d[0] * e2[1] - d[1] * e2[0],
  ];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-9) return null;
  const s = [o[0] - v[a], o[1] - v[a + 1], o[2] - v[a + 2]],
    u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
  if (u < 0 || u > 1) return null;
  const q = [
      s[1] * e1[2] - s[2] * e1[1],
      s[2] * e1[0] - s[0] * e1[2],
      s[0] * e1[1] - s[1] * e1[0],
    ],
    w = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
  if (w < 0 || u + w > 1) return null;
  const hit = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
  return hit >= 0 ? hit : null;
}
export function meshRay(
  m: TriangleMesh,
  o: V3,
  d: V3,
  max: number,
): number | null {
  let root = cache.get(m);
  if (!root) {
    root = tree(
      m,
      Array.from({ length: m.indices.length / 3 }, (_, i) => i),
    );
    cache.set(m, root);
  }
  let best = max,
    found = false;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    let low = 0,
      high = best;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) {
        if (o[k] < n.lo[k] || o[k] > n.hi[k]) {
          high = -1;
          break;
        }
      } else {
        const a = (n.lo[k] - o[k]) / d[k],
          b = (n.hi[k] - o[k]) / d[k];
        low = Math.max(low, Math.min(a, b));
        high = Math.min(high, Math.max(a, b));
      }
    }
    if (high < low) continue;
    if (n.triangles)
      for (const t of n.triangles) {
        const hit = triangle(m, t, o, d);
        if (hit !== null && hit < best) {
          best = hit;
          found = true;
        }
      }
    else {
      stack.push(n.left!, n.right!);
    }
  }
  return found ? best : null;
}

/** Exact triangle/box overlap: broadphase bounds never count as solid mesh. */
export function meshOverlapsBox(m: TriangleMesh, center: V3, half: V3) {
  let root = cache.get(m);
  if (!root) {
    root = tree(
      m,
      Array.from({ length: m.indices.length / 3 }, (_, i) => i),
    );
    cache.set(m, root);
  }
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (half.some((h, i) => n.hi[i] < center[i] - h || n.lo[i] > center[i] + h))
      continue;
    if (!n.triangles) {
      stack.push(n.left!, n.right!);
      continue;
    }
    for (const t of n.triangles) {
      const vertices = [0, 1, 2].map((j) =>
        [0, 1, 2].map(
          (k) => m.vertices[m.indices[t * 3 + j] * 3 + k] - center[k],
        ),
      );
      const edges = vertices.map((v, j) =>
        v.map((x, k) => vertices[(j + 1) % 3][k] - x),
      );
      const cross = (a: number[], b: number[]) => [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
      ];
      const basis = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
      const axes = [
        ...basis,
        cross(edges[0], edges[1]),
        ...edges.flatMap((e) => basis.map((a) => cross(e, a))),
      ];
      const separated = axes.some((axis) => {
        const radius = half.reduce((r, h, i) => r + h * Math.abs(axis[i]), 0);
        const projections = vertices.map((v) =>
          v.reduce((r, x, i) => r + x * axis[i], 0),
        );
        return (
          Math.min(...projections) > radius + 1e-8 ||
          Math.max(...projections) < -radius - 1e-8
        );
      });
      if (!separated) return true;
    }
  }
  return false;
}
