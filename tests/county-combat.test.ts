import { test } from "node:test";
import assert from "node:assert/strict";
import { countyWorld } from "../src/county.ts";
import { Npcs } from "../server/npcs.ts";
import { Spatial } from "../server/spatial.ts";
import type { PlayerState } from "../server/rooms.ts";
import { PerspectiveCamera } from "three";
import { Doodle } from "../src/actors.ts";
test("a county enemy shifts weight across the street and fires bursts while tracking a visible player", () => {
  const city = countyWorld(),
    ai = new Npcs(city, new Spatial(city.boxes));
  assert.equal(ai.actors.length, 4);
  const bot = ai.actors[0];
  ai.actors.splice(1);
  bot.p = [-320, 0, 24];
  const player = {
    p: [-320, 0, 8],
    height: 1.76,
    id: "target",
    hp: 100,
    shieldUntil: 1000,
    yaw: 0,
  } as PlayerState;
  bot.lastShot = 0;
  const shots: number[] = [],
    positions: number[] = [];
  let hits = 0;
  for (let i = 1; i <= 180; i++) {
    const now = (i * 1000) / 30;
    ai.update(
      1 / 30,
      now,
      [player],
      () => hits++,
      () => shots.push(now),
    );
    positions.push(bot.p[0]);
  }
  assert.ok(Math.max(...positions) - Math.min(...positions) > 1);
  assert.ok(shots[0] > player.shieldUntil && hits > 0);
  const gaps = shots.slice(1).map((t, i) => t - shots[i]);
  assert.ok(gaps.some((t) => t < 400) && gaps.some((t) => t > 1000));
});
test("strafe steps use the hips and ankles while the shoulders stay aimed; defeat settles and clears", () => {
  const d = new Doodle(),
    c = new PerspectiveCamera(),
    side: number[] = [];
  try {
    for (let i = 0; i < 120; i++) {
      d.animate(i / 60, 3, c, 0, 1 / 60, 0.05, 0, true);
      side.push(d.leftLeg.rotation.z);
    }
    assert.ok(Math.max(...side) - Math.min(...side) > 0.5);
    assert.ok(Math.abs(d.leftLeg.rotation.x) < 0.3);
    assert.ok(d.pelvis.position.y < 0);
    for (let i = 0; i < 25; i++) d.fall(1 / 60);
    assert.ok(d.group.visible && Math.abs(d.pelvis.rotation.z) > 0.6);
    for (let i = 0; i < 30; i++) d.fall(1 / 60);
    assert.equal(d.group.visible, false);
  } finally {
    d.dispose();
  }
});

test("county parking is repeatable, clear of buildings and separated from the next vehicle", async () => {
  const { parkedCars, VEHICLES } = await import("../src/county.ts");
  const cars = parkedCars(),
    city = countyWorld(),
    spatial = new Spatial(city.boxes);
  assert.deepEqual(cars, parkedCars());
  assert.equal(cars.length, 30);
  assert.deepEqual(new Set(cars.map((c) => c.kind)), new Set(VEHICLES));
  cars.forEach((car, i) => {
    assert.ok(spatial.clear(city.spawns[i]), "the runner has a clear approach");
    for (const length of [-2, 0, 2])
      for (const side of [-0.85, 0.85]) {
        const c = Math.cos(car.yaw),
          s = Math.sin(car.yaw);
        const corner: [number, number, number] = [
          car.p[0] + side * c + length * s,
          car.p[1] + 0.18,
          car.p[2] + length * c - side * s,
        ];
        assert.ok(
          spatial.clear(corner, 1.4),
          "a parking stall intersects scenery",
        );
      }
    cars
      .slice(i + 1)
      .forEach((other) =>
        assert.ok(Math.hypot(car.p[0] - other.p[0], car.p[2] - other.p[2]) > 6),
      );
  });
});
