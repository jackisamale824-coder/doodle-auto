import test from "node:test";
import assert from "node:assert/strict";
import { Controller, Physics, idleInput } from "../src/physics.ts";
import { ropeBlock } from "../src/rope-path.ts";
test("wall contact wraps a connected rope, reel pulls toward the corner, and clear sight unwraps it", async () => {
  const ph = await Physics.create([
    { p: [0, 5, -5], s: [8, 10, 1], solid: true, kind: "wall" },
  ]);
  try {
    const p = new Controller(ph, [0, 3, 0]);
    p.anchor = { x: 0, y: 4.6, z: -10 };
    p.ropeLength = 10;
    p.update(1 / 120, { ...idleInput(), reel: true });
    assert.ok(p.anchor, "wall must not break rope");
    assert.ok(p.ropePath.length > 1, "must wrap");
    let from = p.eye;
    for (const point of p.ropePath) {
      assert.equal(ropeBlock(from, point, ph.ray.bind(ph)), null);
      from = point;
    }
    assert.ok(
      Math.abs(p.velocity.x) > 0.01 || p.velocity.y > 0,
      "force follows edge",
    );
    p.position.set(10, 3, -9);
    p.velocity.set(0, 0, 0);
    p.update(1 / 120, idleInput());
    assert.ok(p.anchor);
    assert.equal(p.ropePath.length, 1, "clear path unwraps");
    p.releaseGrapple();
    assert.equal(p.anchor, null);
    assert.equal(p.ropePath.length, 0);
  } finally {
    ph.dispose();
  }
});
test("surface hook remains attached when the player moves behind its wall", async () => {
  const ph = await Physics.create([
    { p: [0, 5, -5], s: [8, 10, 1], solid: true, kind: "wall" },
  ]);
  try {
    const p = new Controller(ph, [0, 3, 0]);
    p.update(1 / 120, { ...idleInput(), grapple: true });
    assert.ok(p.anchor);
    p.position.z = -8;
    p.update(1 / 120, idleInput());
    assert.ok(p.anchor);
    assert.ok(p.ropePath.length > 1);
    let from = p.eye;
    for (const point of p.ropePath) {
      assert.equal(ropeBlock(from, point, ph.ray.bind(ph)), null);
      from = point;
    }
  } finally {
    ph.dispose();
  }
});

test("multiple obstructions keep every cable segment outside solid geometry", async () => {
  const ph = await Physics.create([
    { p: [0, 5, -5], s: [8, 10, 1], solid: true, kind: "wall" },
    { p: [-4, 5, -8], s: [1, 10, 7], solid: true, kind: "wall" },
  ]);
  try {
    const p = new Controller(ph, [0, 3, 0]);
    p.anchor = { x: 0, y: 4.6, z: -14 };
    p.ropeLength = 24;
    for (let i = 0; i < 30; i++) {
      p.update(1 / 120, idleInput());
      assert.ok(p.anchor);
      let from = p.eye;
      for (const point of p.ropePath) {
        assert.equal(ropeBlock(from, point, ph.ray.bind(ph)), null);
        from = point;
      }
      assert.ok(p.ropePath.length > 1);
    }
  } finally {
    ph.dispose();
  }
});
