import test from "node:test";
import assert from "node:assert/strict";
import { Physics, Controller, idleInput } from "../src/physics.ts";
test("vault is a collision-checked transition lasting at most 0.2 seconds and retains momentum", async () => {
  const physics = await Physics.create([
    { p: [0, -0.5, 0], s: [20, 1, 20], solid: true, kind: "ground" },
    { p: [0, 0.6, 2], s: [3, 1.2, 0.6], solid: true, kind: "prop" },
  ]);
  const p = new Controller(physics, [0, 0.03, 3.3]);
  p.velocity.z = -11;
  p.update(1 / 120, { ...idleInput(), forward: 1, jump: true });
  assert.equal(p.traversing, true);
  assert.equal(p.action, "VAULT");
  let time = 0,
    maxDelta = 0;
  let previous = p.position.clone();
  while (p.traversing && time < 0.5) {
    p.update(1 / 120, idleInput());
    time += 1 / 120;
    maxDelta = Math.max(maxDelta, p.position.distanceTo(previous));
    previous.copy(p.position);
  }
  assert.ok(time <= 0.2 + 1e-6, `duration ${time}`);
  assert.ok(maxDelta < 0.3, `single-frame travel ${maxDelta}`);
  assert.ok(p.position.z < 1.4, `landed at ${p.position.z}`);
  assert.ok(p.speed >= 11, "preserve incoming momentum");
  assert.equal(p.traversing, false);
  physics.dispose();
});
