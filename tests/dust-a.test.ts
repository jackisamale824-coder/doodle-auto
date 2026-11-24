import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import { Spatial } from "../server/spatial.ts";
import { generateLevel, publicMapSeed } from "../src/levels.ts";
import { Physics } from "../src/physics.ts";
import type { V3 } from "../src/world.ts";

test("Dust II shares clear spawns and has separate lanes above and below the A bridge", async () => {
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
    for (let i = 0; i < 450; i++)
      physics.move(runner, new Vector3(0, -0.02, -0.07), 1.8);
    assert.ok(
      runner.z < -8 && Math.abs(runner.y - 3.6) < 0.15,
      "Long A reaches site elevation",
    );
  } finally {
    physics.dispose();
  }
});

test("Dust II navigation connects all spawn areas and the pit", () => {
  const { nodes, links, spawns } = generateLevel("dust-a");
  const neighbors = nodes.map(() => [] as number[]);
  for (const [a, b] of links) {
    neighbors[a].push(b);
    neighbors[b].push(a);
  }
  const nearest = ([x, y, z]: V3) => {
    const distances = nodes.map(([nx, ny, nz]) =>
      Math.hypot(x - nx, y - ny, z - nz),
    );
    const distance = Math.min(...distances);
    assert.ok(distance < 2.2, `Missing walkable node at ${x},${y},${z}`);
    return distances.indexOf(distance);
  };
  const reachable = new Set([nearest(spawns[0])]);
  for (const node of reachable) {
    for (const next of neighbors[node]) reachable.add(next);
  }
  const pit: V3 = [19, -1.55, 41];
  for (const point of [...spawns, pit]) {
    assert.ok(reachable.has(nearest(point)), `Disconnected from A at ${point}`);
  }
});

test("Dust II routes are walkable in both directions with player collision enabled", async () => {
  const city = generateLevel("dust-a");
  const physics = await Physics.create(city.boxes);
  type Waypoint = [number, number];
  function walk(start: V3, route: Waypoint[]) {
    const runner = new Vector3(...start);
    for (const [x, z] of route) {
      const steps =
        Math.ceil(Math.hypot(x - runner.x, z - runner.z) / 0.09) * 2 + 50;
      for (let i = 0; i < steps; i++) {
        const dx = x - runner.x,
          dz = z - runner.z,
          len = Math.hypot(dx, dz);
        if (len < 0.12) break;
        physics.move(
          runner,
          new Vector3((0.09 * dx) / len, -0.025, (0.09 * dz) / len),
          1.8,
        );
      }
      assert.ok(
        Math.hypot(x - runner.x, z - runner.z) < 0.16,
        `Blocked at ${runner.toArray()} on the way to ${x},${z}`,
      );
    }
    return runner.toArray() as V3;
  }
  function roundTrip(start: V3, route: Waypoint[]) {
    const end = walk(start, route);
    walk(end, [...route.slice(0, -1).reverse(), [start[0], start[2]]]);
  }
  try {
    // T spawn to B through Outside Tunnels and the entire upper tunnel.
    roundTrip(
      [-40, 2.48, 63],
      [
        [-63, 63],
        [-63, 57],
        [-71, 57],
        [-71, 49],
        [-84, 49],
        [-84, 2],
        [-80, 2],
        [-80, -10],
      ],
    );
    // Mid to B via Lower, the stairs and Upper.
    roundTrip(
      [-47, 0.08, 24],
      [
        [-47, 16],
        [-84, 16],
        [-84, 1],
        [-80, 1],
        [-80, -10],
      ],
    );
    // Mid Doors, CT cross, B Doors and B Window.
    roundTrip(
      [-47, 0.08, 24],
      [
        [-48, 24],
        [-48, -9],
        [-81, -9],
      ],
    );
    roundTrip(
      [-47, 0.08, 24],
      [
        [-48, 24],
        [-48, -9],
        [-58, -9],
        [-58, -19],
        [-81, -19],
      ],
    );
    // Mid to A on the catwalk and the original short stairs/bridge.
    roundTrip(
      [-47, 0.08, 24],
      [
        [-47, 16],
        [-21, 16],
        [-21, -8],
        [-2, -8],
      ],
    );
    // Lower passage from CT and Long A from T through the long doors.
    roundTrip(
      [-36, 0.08, -13],
      [
        [-15, -13],
        [-15, 5],
      ],
    );
    roundTrip(
      [-40, 2.48, 63],
      [
        [-44, 63],
        [-44, 43],
        [-35, 43],
        [9, 43],
        [9, 32],
        [14, 28],
        [15, 18],
        [15, -8],
        [7, -8],
      ],
    );
  } finally {
    physics.dispose();
  }
});
