import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { Physics } from "../src/physics.ts";
import type { RubblePose } from "../src/county-rubble.ts";
import type { Box } from "../src/world.ts";

test("distant moving rubble costs zero player-world steps and remains precisely hittable before and after teleport", async () => {
  const boxes: Box[] = Array.from({ length: 521 }, (_, i) => ({
    p: [(i % 26) * 3, 1.5 + Math.floor(i / 26) * 3, 0],
    s: [2.9, 2.95, 0.2],
    kind: "exterior",
    piece: "wall",
    pieceId: i,
    solid: false,
  }));
  const physics = await Physics.create(boxes);
  try {
    const initial = physics.world.colliders.len();
    const step = physics.world.step.bind(physics.world);
    let updates = 0;
    physics.world.step = (...args) => {
      updates++;
      return step(...args);
    };
    const pose: RubblePose = {
      id: 1,
      origin: [0, 0, 0],
      p: [128, 0, 0],
      q: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      sleep: false,
    };
    physics.addRubble({ id: 1, indices: boxes.map((_, i) => i), pose });
    const far = new Vector3(-400, 0, 0);
    for (let i = 0; i < 60; i++) {
      // Mirror interpolation's reuse of the pose object and its position array.
      pose.p[0] += 0.1;
      physics.poseRubble(pose);
      physics.move(far, new Vector3(), 1.76);
      const hit = physics.ray(
        new Vector3(100, 1.5, -9),
        new Vector3(1, 0, 0),
        80,
      );
      assert.equal(hit?.box, boxes[3]);
      assert.ok(Math.abs(hit.point[0] - (pose.p[0] - 0.1)) < 1e-5);
      assert.equal(physics.clear(new Vector3(pose.p[0], 0, -9)), false);
      assert.equal(physics.clear(new Vector3(pose.p[0] + 1, 0, -9)), true);
    }
    assert.equal(
      updates,
      0,
      "distant queries and animations must not advance the character world",
    );
    assert.equal(physics.world.colliders.len(), initial);
    const actor = new Vector3(pose.p[0] - 14, 0, -9);
    physics.move(actor, new Vector3(24, 0, 0), 1.76);
    assert.ok(
      actor.x < pose.p[0] && actor.x > pose.p[0] - 1,
      "the swept capsule hits the rotated slab after teleport",
    );
    assert.ok(
      physics.world.colliders.len() > initial &&
        physics.world.colliders.len() < initial + 12,
    );
    assert.equal(updates, 1);
    physics.removeRubblePart(3);
    assert.equal(
      physics.ray(new Vector3(100, 1.5, -9), new Vector3(1, 0, 0), 80),
      null,
    );
    physics.move(actor, new Vector3(3, 0, 0), 1.76);
    assert.ok(actor.x > pose.p[0] + 1);
    physics.move(far, new Vector3(), 1.76);
    assert.equal(physics.world.colliders.len(), initial);
    const released = updates;
    pose.p[0] += 10;
    physics.poseRubble(pose);
    assert.equal(
      physics.ray(new Vector3(100, 1.5, -12), new Vector3(1, 0, 0), 80)?.box,
      boxes[4],
    );
    assert.equal(updates, released);
    physics.clearRubble();
    assert.equal(
      physics.ray(new Vector3(100, 1.5, -12), new Vector3(1, 0, 0), 80),
      null,
    );
  } finally {
    physics.dispose();
  }
});
