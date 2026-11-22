import test from "node:test";
import assert from "node:assert/strict";
import { Physics, Controller, idleInput } from "../src/physics.ts";

test("actual jump apex increases with horizontal speed, preserves momentum and caps the boost", async () => {
  const physics = await Physics.create([
    { p: [0, -0.5, 0], s: [1000, 1, 1000], solid: true, kind: "ground" },
  ]);
  try {
    const heights: number[] = [];
    for (const speed of [0, 8, 13.2, 26.4, 40]) {
      const player = new Controller(physics, [0, 0.03, 0]);
      for (let i = 0; i < 60; i++) player.update(1 / 120, idleInput());
      const start = player.position.y;
      player.velocity.x = speed;
      player.update(1 / 120, { ...idleInput(), jump: true });
      assert.ok(Math.abs(player.speed - speed) < 0.01);
      let apex = player.position.y;
      while (player.velocity.y > 0) {
        player.update(1 / 120, idleInput());
        apex = Math.max(apex, player.position.y);
      }
      heights.push(apex - start);
    }
    assert.ok(heights[0] > 1.7 && heights[0] < 1.9);
    assert.ok(heights[1] > heights[0] + 0.5);
    assert.ok(heights[2] > heights[1] + 0.5);
    assert.ok(heights[3] > heights[2] + 1);
    assert.ok(Math.abs(heights[4] - heights[3]) < 0.01);
    console.log(
      "Measured jump heights:",
      heights.map((h) => h.toFixed(2)),
    );
  } finally {
    physics.dispose();
  }
});

test("Rust tuning reduces standing and sprint jump apex by approximately 15 percent", async () => {
  const physics = await Physics.create([
    { p: [0, -0.5, 0], s: [1000, 1, 1000], solid: true, kind: "ground" },
  ]);
  try {
    for (const speed of [0, 13.2]) {
      const heights: number[] = [];
      for (const scale of [1, 0.85]) {
        const p = new Controller(physics, [0, 0.03, 0]);
        p.jumpHeightScale = scale;
        for (let i = 0; i < 60; i++) p.update(1 / 120, idleInput());
        const start = p.position.y;
        p.velocity.x = speed;
        p.update(1 / 120, { ...idleInput(), jump: true });
        let apex = p.position.y;
        while (p.velocity.y > 0) {
          p.update(1 / 120, idleInput());
          apex = Math.max(apex, p.position.y);
        }
        heights.push(apex - start);
      }
      assert.ok(
        heights[1] / heights[0] > 0.83 && heights[1] / heights[0] < 0.87,
      );
      console.log({ speed, archive: heights[0], rust: heights[1] });
    }
  } finally {
    physics.dispose();
  }
});
