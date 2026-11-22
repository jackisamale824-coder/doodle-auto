import test from "node:test";
import assert from "node:assert/strict";
import { Controller, Physics, GRAPPLE_RANGE } from "../src/physics.ts";
test("hook reaches distant buildings and moving targets up to 120m", async () => {
  const ph = await Physics.create([
    { p: [0, 2, -100], s: [10, 8, 1], solid: true, kind: "wall" },
  ]);
  const p = new Controller(ph, [0, 0, 0]);
  assert.equal(GRAPPLE_RANGE, 120);
  assert.ok(p.grappleHit()!.distance > 99);
  p.movingHooks = () => [
    { id: "airship", position: [0, 1.6, -85], velocity: [0, 0, 0], radius: 2 },
  ];
  assert.equal(p.grappleHit()?.movingId, "airship");
  p.yaw = Math.PI;
  assert.equal(p.grappleHit(), null);
  ph.dispose();
});
test("release boost scales with speed, blends look with trajectory and applies only once", async () => {
  const ph = await Physics.create([]);
  const p = new Controller(ph, [0, 5, 0]);
  const release = (speed: number) => {
    p.velocity.set(speed, 0, 0);
    p.anchor = { x: 0, y: 20, z: 0 };
    p.releaseGrapple();
    return p.velocity.clone();
  };
  const slow = release(10),
    fast = release(20);
  assert.ok(fast.distanceTo(slow.clone().multiplyScalar(2)) < 1e-8);
  assert.ok(Math.abs(fast.x - 22.4) < 1e-8);
  assert.ok(Math.abs(fast.z + 1.6) < 1e-8);
  const before = p.velocity.clone();
  p.releaseGrapple();
  assert.deepEqual(p.velocity.toArray(), before.toArray());
  p.yaw = Math.PI / 2;
  assert.ok(release(20).x > 20, "backwards look cannot erase carried momentum");
  p.velocity.set(0, 0, -45);
  p.yaw = 0;
  p.anchor = { x: 0, y: 20, z: 0 };
  p.releaseGrapple();
  assert.equal(p.velocity.length(), 51);
  p.velocity.set(10, 2, -5);
  p.anchor = { x: 0, y: 20, z: 0 };
  p.releaseGrapple(false, false);
  assert.deepEqual(p.velocity.toArray(), [10, 2, -5]);
  ph.dispose();
});
