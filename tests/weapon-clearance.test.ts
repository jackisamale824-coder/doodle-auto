import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { WeaponClearance } from "../src/weapon-clearance.ts";
import { Physics } from "../src/physics.ts";
test("wall avoidance raises smoothly, returns smoothly and does not alter aim", async () => {
  const physics = await Physics.create([
    { p: [0, 1, -0.5], s: [4, 3, 0.1], kind: "wall", solid: true },
  ]);
  try {
    const c = new WeaponClearance(),
      eye = new Vector3(0, 1.6, 0),
      q = new Quaternion();
    let pose = c.update(1 / 60, eye, q, 0, 0, physics.ray.bind(physics));
    assert.ok(pose.pitch > 0 && pose.pitch < 1.35);
    for (let i = 0; i < 20; i++)
      pose = c.update(1 / 60, eye, q, 0, 0, physics.ray.bind(physics));
    assert.ok(pose.pitch > 1.1);
    assert.ok(pose.retract > 0.5);
    assert.deepEqual(eye.toArray(), [0, 1.6, 0]);
    assert.deepEqual(q.toArray(), [0, 0, 0, 1]);
    const previous = pose.pitch;
    pose = c.update(1 / 60, eye, q, 0, 0, () => null);
    assert.ok(pose.pitch > 0 && pose.pitch < previous);
    for (let i = 0; i < 60; i++)
      pose = c.update(1 / 60, eye, q, 0, 0, () => null);
    assert.ok(pose.pitch < 0.001);
  } finally {
    physics.dispose();
  }
});
test("side probes catch a narrow corner and pistol has a shorter reach", () => {
  const c = new WeaponClearance(),
    q = new Quaternion(),
    p = new Vector3();
  c.update(0.1, p, q, 0, 0, (o) => (o.x > 0.35 ? { distance: 0.4 } : null));
  assert.ok(c.weight > 0.8);
  const reach: number[] = [];
  new WeaponClearance().update(0.1, p, q, 2, 1, (_o, _d, max) => {
    reach.push(max);
    return null;
  });
  assert.ok(reach.every((r) => r < 1));
});
