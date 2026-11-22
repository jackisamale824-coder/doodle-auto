import test from "node:test";
import assert from "node:assert/strict";
import { Waves, waveSettings } from "../src/waves.ts";
test("waves wait for every enemy, offer a break, then spawn progressively faster and respect active cap", () => {
  const w = new Waves();
  let spawned = 0;
  w.update(10, 1, () => {
    spawned++;
  });
  assert.equal(w.number, 1);
  for (let i = 0; i < 61; i++)
    w.update(0.1, 0, () => {
      spawned++;
    });
  assert.equal(w.number, 2);
  assert.equal(w.settings.total, 7);
  for (let i = 0; i < 100; i++)
    w.update(0.1, spawned, () => {
      spawned++;
    });
  assert.equal(spawned, 7);
  assert.equal(w.queued, 0);
  assert.ok(waveSettings(3).speed > waveSettings(2).speed);
  assert.ok(waveSettings(3).spawnInterval < waveSettings(2).spawnInterval);
  w.number = 10;
  w.spawned = 0;
  w.update(3, 16, () => {
    spawned++;
  });
  assert.equal(w.spawned, 0);
  assert.equal(waveSettings(100).total, 40);
});
