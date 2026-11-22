import { writeFileSync } from "node:fs";
import raw from "../src/generated/rust-collision.json";
import { Physics } from "../src/physics.ts";
import { Spatial } from "../server/spatial.ts";
import { Vector3 } from "three";
import type { Box, V3 } from "../src/world.ts";
const boxes = raw as Box[],
  physics = await Physics.create(boxes),
  spatial = new Spatial(boxes),
  nodes: V3[] = [],
  links: [number, number][] = [],
  grid = new Map<string, number>();
for (let z = -29; z <= 25; z += 1.5)
  for (let x = -18; x <= 18; x += 1.5) {
    const hit = physics.ray(new Vector3(x, 2, z), new Vector3(0, -1, 0), 4);
    if (!hit || hit.point[1] > 0.7) continue;
    const p = new Vector3(x, hit.point[1] + 0.06, z);
    if (!physics.clear(p)) continue;
    grid.set(`${x},${z}`, nodes.length);
    nodes.push(p.toArray());
  }
for (const [key, i] of grid) {
  const [x, z] = key.split(",").map(Number);
  for (const [dx, dz] of [
    [1.5, 0],
    [0, 1.5],
  ]) {
    const j = grid.get(`${x + dx},${z + dz}`);
    if (j === undefined || Math.abs(nodes[i][1] - nodes[j][1]) > 0.3) continue;
    if (spatial.movement(nodes[i], nodes[j], 1.76)) links.push([i, j]);
  }
}
// Keep the connected combat floor; no NPCs spawn on isolated decorative ledges.
const remaining = new Set(nodes.map((_, i) => i));
let largest = new Set<number>();
while (remaining.size) {
  const seen = new Set([remaining.values().next().value!]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [a, b] of links)
      if (seen.has(a) !== seen.has(b)) {
        seen.add(a);
        seen.add(b);
        changed = true;
      }
  }
  for (const i of seen) remaining.delete(i);
  if (seen.size > largest.size) largest = seen;
}
const keep = [...largest].sort((a, b) => a - b),
  map = new Map(keep.map((v, i) => [v, i])),
  kept = keep.map((i) => nodes[i]);
const spawns: V3[] = [];
for (const [x, z] of [
  [9, 19],
  [-15, 23],
  [15, 23],
  [-15, -26],
  [15, 0],
  [-15, 0],
  [3, 24],
  [-3, -25],
]) {
  const p = kept.reduce((a, b) =>
    Math.hypot(a[0] - x, a[2] - z) < Math.hypot(b[0] - x, b[2] - z) ? a : b,
  );
  spawns.push(p);
}
writeFileSync(
  "src/generated/rust-navigation.json",
  JSON.stringify({
    nodes: kept,
    links: links
      .filter(([a, b]) => largest.has(a) && largest.has(b))
      .map(([a, b]) => [map.get(a), map.get(b)]),
    spawns,
  }),
);
console.log({ nodes: kept.length, spawns });
physics.dispose();
