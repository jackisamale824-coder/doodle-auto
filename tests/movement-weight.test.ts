import test from "node:test";
import assert from "node:assert/strict";
import { Controller, Physics, idleInput } from "../src/physics.ts";

test("slack hook neither levitates nor passively tows the player", async () => {
  const ph = await Physics.create([]);
  try {
    const p = new Controller(ph, [0, 20, 0]);
    p.anchor = { x: 0, y: 60, z: -40 };
    p.ropeLength = 100;
    for (let i = 0; i < 30; i++) p.update(1 / 120, idleInput());
    assert.ok(p.velocity.y < -8, "gravity should remain weighty while hooked");
    assert.ok(p.speed < 0.01, "slack rope must not create thrust");
  } finally {
    ph.dispose();
  }
});

test("attaching a hook during a fall does not reset vertical momentum", async () => {
  const ph = await Physics.create([
    { p: [0, 20, -30], s: [10, 20, 1], solid: true, kind: "wall" },
  ]);
  try {
    const p = new Controller(ph, [0, 20, 0]);
    p.velocity.y = -12;
    p.update(1 / 120, { ...idleInput(), grapple: true });
    assert.ok(p.anchor);
    assert.ok(
      p.velocity.y < -11,
      "hook attach must not turn falling into upward motion",
    );
  } finally {
    ph.dispose();
  }
});

test("standing jump keeps useful height but lands within 0.68 seconds", async () => {
  const ph = await Physics.create([
    { p: [0, -0.5, 0], s: [200, 1, 200], solid: true, kind: "ground" },
  ]);
  try {
    const p = new Controller(ph, [0, 0.03, 0]);
    for (let i = 0; i < 30; i++) p.update(1 / 120, idleInput());
    const start = p.position.y;
    p.update(1 / 120, { ...idleInput(), jump: true });
    let peak = 0,
      frames = 1;
    while ((frames < 3 || !p.grounded) && frames < 240) {
      p.update(1 / 120, idleInput());
      peak = Math.max(peak, p.position.y - start);
      frames++;
    }
    assert.ok(peak > 1.6 && peak < 1.9, `peak ${peak}`);
    assert.ok(frames / 120 < 0.68, `airtime ${frames / 120}`);
  } finally {
    ph.dispose();
  }
});

test("release impulse remains helpful without runaway speed gain", async () => {
  const ph = await Physics.create([]);
  try {
    const p = new Controller(ph, [0, 20, 0]);
    p.velocity.set(0, 0, -35);
    p.anchor = { x: 0, y: 60, z: -40 };
    p.releaseGrapple();
    assert.ok(p.speed > 35 && p.speed <= 42);
  } finally {
    ph.dispose();
  }
});

test("taut rope holds its length while preserving a swing, and reeling closes distance", async () => {
  for (const dt of [1 / 120, 1 / 60]) {
    const ph = await Physics.create([]);
    try {
      const p = new Controller(ph, [0, 30, 0]);
      p.anchor = { x: 0, y: 51.6, z: 0 };
      p.ropeLength = 20;
      p.velocity.x = 16;
      let stretch = 0;
      for (let t = 0; t < 1; t += dt) {
        p.update(dt, idleInput());
        stretch = Math.max(
          stretch,
          p.eye.distanceTo(p.anchor as any) - p.ropeLength,
        );
      }
      assert.ok(stretch < 0.15, `rope stretch ${stretch}`);
      assert.ok(
        p.position.x > 8,
        "tangential movement must survive rope tension",
      );
      const distance = p.eye.distanceTo(p.anchor as any);
      for (let t = 0; t < 0.5; t += dt)
        p.update(dt, { ...idleInput(), reel: true });
      assert.ok(
        p.eye.distanceTo(p.anchor as any) < distance - 4,
        "reel must pull in",
      );
    } finally {
      ph.dispose();
    }
  }
});
