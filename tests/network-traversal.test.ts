import test from "node:test";
import assert from "node:assert/strict";
import { Physics, Controller, idleInput } from "../src/physics.ts";
import { Spatial } from "../server/spatial.ts";
import type { Box, V3 } from "../src/world.ts";
test("server movement validation accepts the actual 30 Hz vault trajectory", async () => {
  const boxes: Box[] = [
    { p: [0, -0.5, 0], s: [20, 1, 20], solid: true, kind: "ground" },
    { p: [0, 0.6, 2], s: [3, 1.2, 0.6], solid: true, kind: "prop" },
  ];
  const physics = await Physics.create(boxes),
    spatial = new Spatial(boxes);
  const p = new Controller(physics, [0, 0.03, 3.3]);
  p.velocity.z = -11;
  let previous = p.position.toArray() as V3;
  try {
    for (let i = 0; i < 36; i++) {
      p.update(
        1 / 120,
        i === 0 ? { ...idleInput(), forward: 1, jump: true } : idleInput(),
      );
      if (i % 4 === 3) {
        const next = p.position.toArray() as V3;
        assert.ok(
          spatial.movement(previous, next, 1.76),
          `vault rejected at frame ${i}`,
        );
        previous = next;
      }
    }
  } finally {
    physics.dispose();
  }
});
