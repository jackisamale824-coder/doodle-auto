import test from "node:test";
import assert from "node:assert/strict";
import { actorHit, movementYaw } from "../src/actor-hit.ts";
test("shots cover feet, legs, torso, neck and head without gaps", () => {
  for (const y of [0.08, 0.25, 0.5, 0.9, 1.28, 1.35, 1.55, 1.8]) {
    const hit = actorHit(
      [y < 0.68 ? 0.12 : 0, y, 10],
      [0, 0, -1],
      [0, 0, 0],
      1.76,
      20,
    );
    assert.ok(hit, `missed at ${y}`);
    assert.equal(hit.head, y >= 1.32);
    assert.ok(hit.distance < 10);
  }
  assert.equal(actorHit([0, 0.8, 10], [0, 0, -1], [0, 0, 0], 1.76, 9), null);
  assert.equal(actorHit([0.6, 0.8, 10], [0, 0, -1], [0, 0, 0], 1.76, 20), null);
  assert.ok(actorHit([0, 1, 10], [0, 0, -1], [0, 0, 0], 1.08, 20));
});
test("model forward axis follows travel and keeps heading at rest", () => {
  for (const [x, z] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
  ]) {
    const modelYaw = movementYaw(x, z, 0) + Math.PI;
    assert.ok(Math.abs(Math.sin(modelYaw) - x / Math.hypot(x, z)) < 1e-8);
    assert.ok(Math.abs(Math.cos(modelYaw) - z / Math.hypot(x, z)) < 1e-8);
  }
  assert.equal(movementYaw(0, 0, 1.2), 1.2);
});

test("anatomic regions rotate with actors, scale for crouch and preserve limb gaps", () => {
  const cases = [
    [0, 1.55, "head", 2.4],
    [0, 1, "body", 1],
    [0.32, 1.12, "arm", 0.65],
    [0.12, 0.35, "leg", 0.75],
  ] as const;
  for (const [x, y, region, multiplier] of cases) {
    for (const yaw of [0, Math.PI / 2, Math.PI, -0.7]) {
      for (const scale of [1, 1.08 / 1.76]) {
        const c = Math.cos(yaw),
          s = Math.sin(yaw);
        const hit = actorHit(
          [c * x + s * 10, y * scale, -s * x + c * 10],
          [-s, 0, -c],
          [0, 0, 0],
          1.76 * scale,
          20,
          yaw,
        );
        assert.equal(hit?.region, region);
        assert.equal(hit?.multiplier, multiplier);
      }
    }
  }
  assert.equal(
    actorHit([0, 0.3, 10], [0, 0, -1], [0, 0, 0], 1.76, 20),
    null,
    "gap between legs is not a body hit",
  );
});
