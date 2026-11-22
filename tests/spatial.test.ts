import test from "node:test";
import assert from "node:assert/strict";
import { Spatial } from "../server/spatial.ts";
import { generateCity, worldRay, type V3 } from "../src/world.ts";
test("spatial broadphase agrees with full world rays and blocks swept movement through walls", () => {
  const city = generateCity("paper"),
    index = new Spatial(city.boxes);
  for (let i = 0; i < 60; i++) {
    const o: V3 = [(i % 10) * 7 - 30, 1.6, Math.floor(i / 10) * 11 - 30],
      d: V3 = [Math.sin(i), 0, Math.cos(i)];
    assert.equal(
      index.ray(o, d, 70)?.distance,
      worldRay(city.boxes, o, d, 70)?.distance,
    );
  }
  const wall = new Spatial([
    { p: [0, 2, 0], s: [8, 4, 0.2], kind: "wall", solid: true },
  ]);
  assert.equal(wall.movement([0, 0, 1], [0, 0, -1], 1.76), false);
  assert.equal(wall.movement([0, 5, 1], [0, 5, -1], 1.76), true);
});
