import assert from "node:assert/strict";
import test from "node:test";
import { Spatial } from "../server/spatial.ts";
import { crossings, islands, ISLANDS, SEA_LEVEL } from "../src/islands.ts";
import { generateLevel, publicMapSeed } from "../src/levels.ts";

test("Four Tides has walkable crossings, clear spawns and open water", () => {
  const city = generateLevel(ISLANDS);
  const spatial = new Spatial(city.boxes);
  assert.equal(city.seed, ISLANDS);
  assert.equal(city.beacons.length, 3);
  assert.equal(crossings.length, 8);
  for (const [from, to] of crossings) {
    const a = islands[from],
      b = islands[to];
    for (let step = 0; step <= 16; step++) {
      const x = a.x + ((b.x - a.x) * step) / 16;
      const z = a.z + ((b.z - a.z) * step) / 16;
      assert.ok(
        spatial.ray([x, 1, z], [0, -1, 0], 1.1),
        `Missing deck at ${x}, ${z}`,
      );
    }
  }
  for (const spawn of city.spawns) assert.ok(spatial.clear(spawn));
  assert.equal(spatial.ray([68, 1, 68], [0, -1, 0], 1 - SEA_LEVEL + 1), null);
  assert.equal(publicMapSeed("city:notebook"), ISLANDS);
  assert.notEqual(publicMapSeed("rust"), ISLANDS);
  assert.notEqual(publicMapSeed("switchback-county"), ISLANDS);
});
