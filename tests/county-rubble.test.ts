import test from "node:test";
import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { CountyRubble, type RubblePose } from "../src/county-rubble.ts";
import type { Box, V3 } from "../src/world.ts";

await RAPIER.init();
function box(p: V3, s: V3, kind = "exterior"): Box {
  return { p, s, kind, solid: true };
}
const ground = () => box([0, -1, 0], [120, 2, 120], "ground");
function settle(sim: CountyRubble, pose: RubblePose) {
  for (let i = 0; i < 1200 && !pose.sleep; i++)
    pose = sim.step(1 / 60).find((p) => p.id === pose.id) ?? pose;
  assert.ok(pose.sleep, "cluster should sleep on contact");
  return pose;
}
test("a slender facade tips toward the breach and its attached fitting settles with it", () => {
  const boxes = [
    ground(),
    box([0, 5, 0], [0.5, 10, 3]),
    box([0, 9, -1.65], [0.45, 1, 0.5]),
  ];
  const sim = new CountyRubble(boxes);
  try {
    const start = sim.spawn(4, [1, 2], [1, 0, 0]);
    assert.ok(sim.ray([-4, 9, -1.65], [1, 0, 0], 8)?.box === boxes[2]);
    assert.ok(sim.overlaps([0, 8.4, -1.65], 1));
    const pose = settle(sim, start);
    const direction = new Vector3(0, 1, 0).applyQuaternion(
      new Quaternion(...pose.q),
    );
    assert.ok(direction.x > 0.8 && pose.p[1] < 1, JSON.stringify(pose));
    assert.ok(pose.p[0] > 2, "the top of the facade falls toward the breach");
    const fitting = new Vector3(...boxes[2].p)
      .sub(new Vector3(...pose.origin))
      .applyQuaternion(new Quaternion(...pose.q))
      .add(new Vector3(...pose.p));
    assert.ok(sim.overlaps([fitting.x, fitting.y - 0.4, fitting.z], 0.8));
    assert.ok(
      sim.ray([fitting.x, fitting.y + 4, fitting.z], [0, -1, 0], 8)?.box ===
        boxes[2],
    );
    sim.removePart(2);
    assert.notEqual(
      sim.ray([fitting.x, fitting.y + 4, fitting.z], [0, -1, 0], 8)?.box,
      boxes[2],
    );
    const next = settle(sim, { ...pose, sleep: false });
    assert.deepEqual(sim.step(1), []);
    assert.equal(next.id, 4);
  } finally {
    sim.dispose();
  }
});
test("detached slabs land on intact architecture then fall when the support is destroyed", () => {
  const blocks = [
    ground(),
    box([0, 3, 0], [24, 6, 24], "building"),
    box([0, 9, 0], [2, 0.4, 2]),
  ];
  const sim = new CountyRubble(blocks);
  try {
    const first = settle(sim, sim.spawn(7, [2], [0, 0, 1]));
    assert.ok(first.p[1] > 6 && first.p[1] < 7, JSON.stringify(first));
    sim.removeStatic(1);
    const final = settle(sim, { ...first, sleep: false });
    assert.ok(final.p[1] < 1.2 && final.p[1] > 0.1, JSON.stringify(final));
  } finally {
    sim.dispose();
  }
});
test("secondary fractures preserve their world transform and fall onto sleeping rubble", () => {
  const blocks = [
    ground(),
    box([0, 1, 0], [18, 2, 18]),
    box([-1.5, 10, 0], [1, 1, 1]),
    box([1.5, 10, 0], [1, 1, 1]),
  ];
  const sim = new CountyRubble(blocks);
  try {
    const base = settle(sim, sim.spawn(1, [1], [1, 0, 0]));
    assert.ok(base.p[1] > 0.8 && base.p[1] < 1.3);
    let upper = sim.spawn(2, [2, 3], [0, 0, 1]);
    for (let i = 0; i < 20; i++)
      upper = sim.step(1 / 60).find((p) => p.id === 2) ?? upper;
    const expected = new Vector3(...blocks[3].p)
      .sub(new Vector3(...upper.origin))
      .applyQuaternion(new Quaternion(...upper.q))
      .add(new Vector3(...upper.p));
    sim.removeParts([2, 3]);
    const split = sim.spawn(3, [3], [1, 0, 0], upper);
    assert.ok(new Vector3(...split.p).distanceTo(expected) < 1e-5);
    assert.deepEqual(split.q, upper.q);
    const rested = settle(sim, split);
    assert.ok(rested.p[1] > 2.25 && rested.p[1] < 3.2, JSON.stringify(rested));
  } finally {
    sim.dispose();
  }
});

test("moving an intact support updates the contact surface, including across spatial cells", () => {
  const blocks = [
    ground(),
    box([0, 2, 0], [14, 4, 14]),
    box([0, 6, 0], [1, 1, 1]),
    box([32, 9, 0], [1, 1, 1]),
  ];
  const sim = new CountyRubble(blocks);
  try {
    const before = settle(sim, sim.spawn(1, [2], [1, 0, 0]));
    assert.ok(before.p[1] > 4);
    blocks[1].p = [32, 3, 0];
    blocks[1].s = [14, 6, 14];
    sim.syncStatic(1);
    const after = settle(sim, { ...before, sleep: false });
    assert.ok(after.p[1] < 1);
    const moved = settle(sim, sim.spawn(2, [3], [1, 0, 0]));
    assert.ok(moved.p[1] > 6 && moved.p[1] < 7);
  } finally {
    sim.dispose();
  }
});

test("sloped terrain provides its mesh surface, and fixed steps agree across frame rates", () => {
  const terrain = box([0, 2, 0], [60, 4, 60], "ground");
  terrain.mesh = {
    vertices: [-30, 0, -30, 30, 4, -30, -30, 0, 30, 30, 4, 30],
    indices: [0, 2, 1, 1, 2, 3],
  };
  function run(rate: number) {
    const sim = new CountyRubble([terrain, box([0, 10, 0], [1, 1, 1])]);
    try {
      let pose = sim.spawn(1, [1], [0, 0, 1]);
      for (let i = 0; i < rate; i++) pose = sim.step(1 / rate)[0] ?? pose;
      const rested = settle(sim, pose);
      assert.ok(Math.abs(rested.p[1] - (2 + rested.p[0] / 15 + 0.5)) < 0.15);
      return pose;
    } finally {
      sim.dispose();
    }
  }
  assert.deepEqual(run(120), run(30));
});
