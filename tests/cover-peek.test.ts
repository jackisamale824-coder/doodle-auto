import test from "node:test";
import assert from "node:assert/strict";
import {
  CoverPeek,
  coverSide,
  peekEye,
  validatedLean,
} from "../src/cover-peek.ts";
import { Spatial } from "../server/spatial.ts";
import { actorHit } from "../src/actor-hit.ts";
const wall = {
  p: [-1, 1, -0.8],
  s: [2.5, 3, 0.2],
  solid: true,
  kind: "wall",
} as any;
test("only clear wall edges permit a peek; broad walls and blocked sides do not", () => {
  const s = new Spatial([wall]),
    ray = s.ray.bind(s),
    eye: [number, number, number] = [0, 1.6, 0];
  assert.equal(coverSide(eye, 0, 0, ray), 1);
  assert.equal(
    coverSide(eye, 0, 0, () => null),
    0,
  );
  assert.equal(
    coverSide(
      eye,
      0,
      0,
      new Spatial([{ ...wall, p: [0, 1, -0.8], s: [10, 3, 0.2] }]).ray.bind(
        new Spatial([{ ...wall, p: [0, 1, -0.8], s: [10, 3, 0.2] }]),
      ),
    ),
    0,
  );
  const blocked = new Spatial([
    wall,
    { p: [0.3, 1, 0], s: [0.1, 3, 2], solid: true, kind: "wall" },
  ]);
  assert.equal(coverSide(eye, 0, 0, blocked.ray.bind(blocked)), 0);
  assert.equal(validatedLean(eye, 0, 0, 0.5, ray), 0.5);
  assert.equal(validatedLean(eye, 0, 0, 5, ray), 0);
  assert.equal(validatedLean(eye, 0, 0, -0.5, ray), 0);
  assert.equal(validatedLean(eye, 0, 0, NaN, ray), 0);
});
test("peek blends in while aiming, returns on release, and moves the shot past the edge", () => {
  const s = new Spatial([wall]),
    ray = s.ray.bind(s),
    eye: [number, number, number] = [0, 1.6, 0],
    p = new CoverPeek();
  assert.equal(p.update(0.1, eye, 0, 0, false, ray), 0);
  assert.ok(p.update(1 / 60, eye, 0, 0, true, ray) > 0 && p.lean < 0.5);
  for (let i = 0; i < 30; i++) p.update(1 / 60, eye, 0, 0, true, ray);
  assert.ok(p.lean > 0.49);
  assert.ok(ray(eye, [0, 0, -1], 5));
  assert.equal(ray(peekEye(eye, 0, p.lean), [0, 0, -1], 5), null);
  p.update(1 / 60, eye, 0, 0, false, ray);
  assert.ok(p.lean > 0 && p.lean < 0.49);
  for (let i = 0; i < 60; i++) p.update(1 / 60, eye, 0, 0, false, ray);
  assert.ok(p.lean < 0.001);
});
test("leaned upper-body hitboxes expose the head without moving the feet", () => {
  assert.equal(
    actorHit([0.5, 1.55, 5], [0, 0, -1], [0, 0, 0], 1.76, 10, Math.PI),
    null,
  );
  assert.equal(
    actorHit([0.5, 1.55, 5], [0, 0, -1], [0, 0, 0], 1.76, 10, Math.PI, 0.5)
      ?.region,
    "head",
  );
  assert.equal(
    actorHit([0.5, 0.3, 5], [0, 0, -1], [0, 0, 0], 1.76, 10, Math.PI, 0.5),
    null,
  );
});
