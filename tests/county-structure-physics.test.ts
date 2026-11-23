import { test } from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { CountyStructures } from "../src/county-structures.ts";
import { Physics } from "../src/physics.ts";
import { Spatial } from "../server/spatial.ts";
import type { Box, V3 } from "../src/world.ts";

test("door leaves rotate across broadphase cells and remain hittable when open", async () => {
  const leaf: Box = {
    piece: "door",
    pieceId: 0,
    p: [12.8, 1.5, 12.2],
    s: [2, 3, 0.12],
    kind: "building",
    solid: true,
  };
  const boxes = [leaf],
    spatial = new Spatial(boxes),
    physics = await Physics.create(boxes);
  try {
    const state = new CountyStructures(boxes, (_i, _s, b) =>
      physics.updateStructure(b),
    );
    const compare = (p: V3, d: V3, range: number, expected: boolean) => {
      assert.equal(Boolean(spatial.ray(p, d, range)), expected, "server");
      assert.equal(
        Boolean(physics.ray(new Vector3(...p), new Vector3(...d), range)),
        expected,
        "client",
      );
    };
    compare([12.8, 1.5, 13.4], [0, 0, -1], 2, true);
    state.operate(0, true, [12.8, 1.5, 13.4], [], spatial.ray.bind(spatial));
    assert.equal(state.states.get(0), 1);
    compare([12.8, 1.5, 13.4], [0, 0, -1], 2, false);
    compare([10.5, 1.5, 11], [1, 0, 0], 2, true);
    state.operate(
      0,
      false,
      [10.5, 1.5, 11],
      [{ p: [12.8, 0, 12.2], height: 1.76 }],
      spatial.ray.bind(spatial),
    );
    assert.equal(state.states.get(0), 1, "cannot close on an occupant");
    state.damage(0, 50);
    compare([10.5, 1.5, 11], [1, 0, 0], 2, false);
    state.operate(0, true, [12.8, 1.5, 13.4], [], spatial.ray.bind(spatial));
    assert.equal(state.states.get(0), 2);
  } finally {
    physics.dispose();
  }
});

test("a fallen wall blocks actors and shots in its rotated position and clears on the next fracture", async () => {
  const shape: Box = {
    piece: "wall",
    pieceId: 0,
    solid: false,
    p: [0, 1.5, 0],
    s: [4, 3, 0.24],
    kind: "exterior",
  };
  const physics = await Physics.create([shape]);
  try {
    const pose = {
      id: 1,
      origin: [0, 1.5, 0] as V3,
      p: [12, 1.5, 8] as V3,
      q: [0, Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number, number],
      sleep: false,
    };
    physics.addRubble({ id: 1, indices: [0], pose });
    const shoot = () =>
      physics.ray(new Vector3(9, 1.4, 8), new Vector3(1, 0, 0), 5);
    assert.equal(shoot()?.box, shape);
    const actor = new Vector3(10, 0, 8);
    physics.move(actor, new Vector3(4, 0, 0), 1.76);
    assert.ok(actor.x < 12);
    physics.poseRubble({ ...pose, p: [19, 1.5, 8], sleep: true });
    assert.equal(shoot(), null);
    assert.equal(
      physics.ray(new Vector3(17, 1.5, 8), new Vector3(1, 0, 0), 5)?.box,
      shape,
    );
    physics.removeRubblePart(0);
    assert.equal(
      physics.ray(new Vector3(17, 1.5, 8), new Vector3(1, 0, 0), 5),
      null,
    );
  } finally {
    physics.dispose();
  }
});

test("a whole wall detaches from the character world without rebuilding the static query tree", async () => {
  const wall: Box = {
    p: [0, 1.5, 0],
    s: [5, 3, 0.2],
    piece: "wall",
    kind: "exterior",
    solid: true,
  };
  const physics = await Physics.create([wall]);
  try {
    const state = new CountyStructures([wall], (_i, _s, b) =>
      physics.updateStructure(b),
    );
    const p = new Vector3(0, 0, 1.5),
      delta = new Vector3(0, 0, -3);
    physics.move(p, delta, 1.76);
    assert.ok(p.z > 0);
    const step = physics.world.step.bind(physics.world);
    let count = 0;
    physics.world.step = (...args) => {
      count++;
      return step(...args);
    };
    state.set(0, 2);
    assert.ok(physics.clear(new Vector3(0, 0, 0)));
    assert.equal(
      physics.ray(new Vector3(0, 1.5, 1), new Vector3(0, 0, -1), 2),
      null,
    );
    physics.move(p, delta, 1.76);
    assert.ok(p.z < 0);
    assert.equal(count, 0);
  } finally {
    physics.dispose();
  }
});
