import test from "node:test";
import assert from "node:assert/strict";
import { generateCity } from "../src/world.ts";
import { blimpPosition, blimpVelocity } from "../src/aerial.ts";
import { Physics, Controller, idleInput } from "../src/physics.ts";
test("vertical city has connected walkable sky bridges and reachable aerial tiers", async () => {
  const city = generateCity("notebook");
  assert.ok(Math.max(...city.buildings.map((b) => b.floors)) >= 16);
  assert.ok(city.bridges.length >= 40);
  assert.ok(city.blimps.length > 150);
  assert.ok(city.platforms.length >= 36);
  assert.equal(
    new Set(city.platforms.map((p) => p.p[0] + "," + p.p[2])).size,
    city.platforms.length,
  );
  const physics = await Physics.create(city.boxes);
  try {
    for (const bridge of city.bridges) {
      const p = new Controller(physics, [
        bridge.from[0],
        bridge.from[1] + 0.05,
        bridge.from[2] - 0.8,
      ]);
      p.yaw = Math.PI;
      for (let i = 0; i < 600 && p.position.z < bridge.to[2] + 0.7; i++)
        p.update(1 / 120, { ...idleInput(), forward: 1 });
      assert.ok(
        p.position.z >= bridge.to[2] + 0.7,
        `bridge ${bridge.a}-${bridge.b} blocked at ${p.position.toArray()}`,
      );
      assert.ok(
        Math.abs(p.position.y - bridge.to[1]) < 0.2,
        `fell from bridge ${bridge.a}`,
      );
    }
    for (const platform of city.platforms) {
      const p = new Controller(physics, [
        platform.p[0],
        platform.p[1] + 2,
        platform.p[2],
      ]);
      for (let i = 0; i < 120; i++) p.update(1 / 120, idleInput());
      assert.ok(p.grounded);
      assert.ok(Math.abs(p.position.y - platform.p[1]) < 0.1);
    }
  } finally {
    physics.dispose();
  }
});
test("blimp trajectories stay continuous across clock boundaries with matching velocity", () => {
  const b = {
    id: "test",
    center: [0, 50, 0] as [number, number, number],
    radius: 12,
    phase: 0.7,
    speed: 0.095,
  };
  for (const time of [3599.999, 3600, Date.now() / 1000]) {
    const a = blimpPosition(b, time),
      next = blimpPosition(b, time + 0.001),
      v = blimpVelocity(b, time);
    assert.deepEqual(a, blimpPosition(b, time));
    a.forEach((x, i) =>
      assert.ok(Math.abs((next[i] - x) / 0.001 - v[i]) < 0.002),
    );
  }
});
test("moving grapple follows its target, preserves release momentum and respects occlusion", async () => {
  const physics = await Physics.create([]);
  const p = new Controller(physics, [0, 0, 0]);
  const target = {
    id: "blimp",
    position: [0, 10, -20] as [number, number, number],
    velocity: [1, 0, 0] as [number, number, number],
    radius: 1.8,
  };
  p.movingHooks = () => [target];
  p.pitch = Math.atan2(10 - p.eye.y, 20);
  p.update(1 / 120, { ...idleInput(), grapple: true });
  assert.equal(p.movingAnchor, "blimp");
  target.position[0] = 2;
  p.update(1 / 120, idleInput());
  assert.equal(p.anchor?.x, 2);
  const velocity = p.velocity.toArray();
  p.releaseGrapple();
  assert.equal(p.movingAnchor, null);
  assert.ok(p.velocity.length() >= Math.hypot(...velocity));
  assert.ok(
    p.velocity.toArray().reduce((dot, v, i) => dot + v * velocity[i], 0) > 0,
  );
  physics.dispose();
  const blocked = await Physics.create([
    { p: [0, 8, -10], s: [10, 16, 1], kind: "wall", solid: true },
  ]);
  const q = new Controller(blocked, [0, 0, 0]);
  q.movingHooks = () => [target];
  q.pitch = p.pitch;
  assert.equal(q.grappleHit()?.movingId, undefined);
  blocked.dispose();
});

test("sky field stays connected, clear and within grapple range throughout its motion across seeds", async () => {
  for (const seed of ["notebook", "sky-2", "sky-3", "sky-4"]) {
    const city = generateCity(seed);
    const physics = await Physics.create(city.boxes);
    try {
      const byId = new Map(city.blimps.map((b) => [b.id, b]));
      const seen = new Set([city.blimps[0].id]);
      for (let i = 0; i < city.blimps.length; i++)
        for (const [a, b] of city.aerialLinks) {
          if (seen.has(a)) seen.add(b);
          if (seen.has(b)) seen.add(a);
        }
      assert.equal(seen.size, city.blimps.length);
      assert.equal(city.aerialEntries.length, 16);
      assert.ok(
        new Set(
          city.blimps
            .filter((b) => b.id.startsWith("sky-"))
            .map((b) => b.center[1]),
        ).size >= 3,
      );
      for (const time of [0, 8, 20, 40, 60, 80])
        for (const [a, b] of city.aerialLinks) {
          const start = blimpPosition(byId.get(a)!, time),
            end = blimpPosition(byId.get(b)!, time);
          start[1] -= 4;
          end[1] -= 4;
          const delta = end.map((v, i) => v - start[i]);
          const distance = Math.hypot(...delta);
          assert.ok(
            distance + 6 < 65,
            `${seed}: unreachable edge ${a} -> ${b}`,
          );
          const player = new Controller(physics, start);
          const origin = player.position.clone(),
            direction = player.position.clone().fromArray(delta).normalize();
          assert.equal(
            physics.ray(origin, direction, distance - 0.1),
            null,
            `${seed}: blocked sky edge ${a} -> ${b}`,
          );
        }
      for (const entry of city.aerialEntries) {
        const roof = city.buildings[entry.building],
          hook = byId.get(entry.hook)!;
        assert.ok(hook.center[1] - 4 - roof.height < 12);
      }
    } finally {
      physics.dispose();
    }
  }
});
