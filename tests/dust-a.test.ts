import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import { Spatial } from "../server/spatial.ts";
import { generateLevel, publicMapSeed } from "../src/levels.ts";
import { Physics } from "../src/physics.ts";

test("Dust A shares clear spawns and has separate lanes above and below the bridge", async () => {
  const city = generateLevel(publicMapSeed("dust-a"));
  assert.equal(city.seed, "dust-a");
  const spatial = new Spatial(city.boxes);
  for (const spawn of city.spawns) assert.ok(spatial.clear(spawn));
  assert.ok(spatial.clear([-15, 0.1, -8]));
  assert.ok(spatial.clear([-15, 3.7, -8]));
  assert.equal(spatial.clear([-15, 2.9, -8]), false);

  const physics = await Physics.create(city.boxes);
  try {
    const runner = new Vector3(15, 0.08, 18);
    for (let i = 0; i < 450; i++) physics.move(runner, new Vector3(0, -0.02, -0.07), 1.8);
    assert.ok(runner.z < -8 && Math.abs(runner.y - 3.6) < 0.15, "Long A reaches site elevation");
  } finally {
    physics.dispose();
  }
});
