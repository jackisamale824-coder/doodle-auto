import test from "node:test";
import assert from "node:assert/strict";
import { generateCity } from "../src/world.ts";
import { Physics, Controller, idleInput } from "../src/physics.ts";
test("every building has a physically walkable entrance-to-roof stair route", async () => {
  const city = generateCity("notebook");
  const physics = await Physics.create(city.boxes);
  for (const building of city.buildings) {
    const p = new Controller(physics, [
      building.x,
      0.25,
      building.z + building.d / 2 + 2,
    ]);
    const route = [
      [building.x, 0.2, building.z + building.d / 2 - 1],
      ...building.route,
    ];
    for (const point of route) {
      for (let i = 0; i < 1600; i++) {
        const dx = point[0] - p.position.x,
          dz = point[2] - p.position.z;
        if (
          Math.hypot(dx, dz) < 0.24 &&
          Math.abs(p.position.y - point[1]) < 0.45
        )
          break;
        p.yaw = Math.atan2(-dx, -dz);
        p.update(1 / 120, { ...idleInput(), forward: 1 });
      }
      assert.ok(
        Math.hypot(point[0] - p.position.x, point[2] - p.position.z) < 0.6 &&
          Math.abs(point[1] - p.position.y) < 0.5,
        `stuck en route to ${point}, at ${p.position.toArray()}`,
      );
    }
    assert.ok(
      p.position.y >= building.height - 0.1,
      `roof is ${building.height}, player ${p.position.y}`,
    );
  }
  physics.dispose();
});
test("a ceiling blocks upward movement", async () => {
  const physics = await Physics.create([
    { p: [0, -0.5, 0], s: [10, 1, 10], kind: "ground", solid: true },
    { p: [0, 2.5, 0], s: [10, 0.2, 10], kind: "wall", solid: true },
  ]);
  const p = new Controller(physics, [0, 0.03, 0]);
  for (let i = 0; i < 30; i++) p.update(1 / 120, idleInput());
  p.update(1 / 120, { ...idleInput(), jump: true });
  for (let i = 0; i < 20; i++) p.update(1 / 120, idleInput());
  assert.ok(p.position.y + p.height < 2.41);
  physics.dispose();
});
test("wall running slows a fall and a wall jump pushes away", async () => {
  const physics = await Physics.create([
    { p: [0, -0.5, 0], s: [100, 1, 100], kind: "ground", solid: true },
    { p: [1, 5, 0], s: [0.2, 10, 30], kind: "wall", solid: true },
  ]);
  const p = new Controller(physics, [0.45, 4, 5]);
  p.velocity.set(0, -4, -10);
  p.airTime = 0.2;
  for (let i = 0; i < 12; i++)
    p.update(1 / 120, { ...idleInput(), forward: 1 });
  assert.equal(p.action, "WALL RUN");
  assert.ok(p.velocity.y > -2);
  p.update(1 / 120, { ...idleInput(), forward: 1, jump: true });
  assert.ok(p.velocity.x < -5);
  assert.ok(p.velocity.y > 7);
  physics.dispose();
});
