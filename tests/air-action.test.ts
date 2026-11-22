import test from "node:test";
import assert from "node:assert/strict";
import { Physics, Controller, idleInput } from "../src/physics.ts";
test("double jump and boost share one charge, landing restores it and held keys do not repeat", async () => {
  const physics = await Physics.create([
    { p: [0, -0.5, 0], s: [1000, 1, 1000], solid: true, kind: "ground" },
  ]);
  const p = new Controller(physics, [0, 3, 0]);
  try {
    const step = (input = {}) =>
      p.update(1 / 120, { ...idleInput(), ...input });
    step({ jump: true });
    assert.equal(p.action, "DOUBLE JUMP");
    assert.equal(p.airActionReady, false);
    const vy = p.velocity.y;
    step({ jump: true });
    assert.ok(p.velocity.y < vy);
    const speed = p.speed;
    step({ boost: true });
    assert.ok(p.speed <= speed + 0.01);
    for (let i = 0; i < 400 && !p.grounded; i++) step();
    assert.equal(p.grounded, true);
    assert.equal(p.airActionReady, true);
    step({ jump: true });
    step();
    step({ boost: true, side: 1 });
    assert.equal(p.action, "AIR BOOST");
    assert.ok(p.velocity.x > 10);
    assert.equal(p.airActionReady, false);
    const after = p.velocity.y;
    step({ jump: true });
    assert.ok(p.velocity.y < after);
    p.reset([0, 3, 0]);
    assert.equal(p.airActionReady, true);
  } finally {
    physics.dispose();
  }
});
