import test from "node:test";
import assert from "node:assert/strict";
import { generateCity, rayBox } from "../src/world.ts";

test("city seeds reproduce geometry and districts change it", () => {
  const a = generateCity("notebook", 1);
  assert.deepEqual(a, generateCity("notebook", 1));
  assert.notDeepEqual(a, generateCity("notebook", 2));
  assert.equal(a.buildings.length, 25);
});
test("buildings occupy separate lots and each has interior stairs reaching its roof", () => {
  for (let seed = 0; seed < 8; seed++) {
    const c = generateCity(String(seed), 1);
    for (const b of c.buildings) {
      assert.ok(b.route.length > 10);
      assert.ok(Math.abs(b.route.at(-1)![1] - b.height) < 0.5);
      assert.ok(
        !c.boxes.some(
          (x) =>
            x.solid &&
            rayBox([b.x, 1.5, b.z + b.d / 2 + 1], [0, 0, -1], x, 2) !== null,
        ),
      );
      for (const other of c.buildings)
        if (b.id !== other.id)
          assert.ok(
            Math.abs(b.x - other.x) > (b.w + other.w) / 2 ||
              Math.abs(b.z - other.z) > (b.d + other.d) / 2,
          );
    }
    assert.equal(c.beacons.length, 3);
    assert.ok(new Set(c.buildings.map((b) => b.kind)).size >= 3);
  }
});
test("ray tests stop at walls and ignore intersections behind the shooter", () => {
  const b = { p: [0, 1, 0], s: [2, 2, 2], solid: true, kind: "wall" } as any;
  assert.equal(rayBox([0, 1, 5], [0, 0, -1], b, 10), 4);
  assert.equal(rayBox([0, 1, 5], [0, 0, 1], b, 10), null);
});

test("rooftop water tanks and parked cars have climbable collision geometry", async () => {
  const { worldRay } = await import("../src/world.ts");
  const city = generateCity("notebook");
  const b = city.buildings[12];
  const tank = worldRay(
    city.boxes,
    [b.x + 4, b.height + 2.3, b.z + 1],
    [0, 0, -1],
    5,
  );
  assert.equal(tank?.box.kind, "collision");
  const car = worldRay(city.boxes, [12.8, 0.9, 8], [0, 0, -1], 5);
  assert.equal(car?.box.kind, "collision");
});
