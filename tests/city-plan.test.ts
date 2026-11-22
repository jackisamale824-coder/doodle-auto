import test from "node:test";
import assert from "node:assert/strict";
import { generateCity, worldRay, distance } from "../src/world.ts";
test("district pipeline preserves connected streets, frontage, clear spawns and roof opportunities across seeds", () => {
  for (let i = 0; i < 12; i++) {
    const c = generateCity(`pipeline-${i}`);
    assert.equal(new Set(c.buildings.map((b) => b.neighborhood)).size, 4);
    assert.equal(c.spawns.length, 8);
    const seen = new Set([0]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [a, b] of c.links)
        if (seen.has(a) !== seen.has(b)) {
          seen.add(a);
          seen.add(b);
          changed = true;
        }
    }
    assert.equal(
      seen.size,
      c.nodes.length,
      "street and interior graph connected",
    );
    for (const b of c.buildings) {
      const parcel = c.plan.parcels.find((p) => p.id === b.parcelId)!;
      const street = c.plan.streets.find((s) => s.id === parcel.streetId)!;
      const o: [number, number, number] = [b.x, 1, street.a[2]],
        d = distance(o, [b.x, 1, b.entrance[2]]);
      assert.equal(
        worldRay(c.boxes, o, [0, 0, Math.sign(b.entrance[2] - street.a[2])], d),
        null,
        "frontage approach unobstructed",
      );
    }
    for (const p of c.spawns)
      assert.equal(
        worldRay(c.boxes, [p[0], 0.3, p[2]], [0, 1, 0], 1.5),
        null,
        "spawn has headroom",
      );
    assert.ok(c.roofLinks.length > 0, "reachable rooftop graph");
  }
});
test("regional infill regeneration keeps streets and authored overrides stable", () => {
  const baseline = generateCity("regional");
  const hero = baseline.buildings.find((b) => b.neighborhood === "press")!;
  const overrides = {
    buildings: { [hero.parcelId]: { name: "THE SAFEHOUSE", floors: 3 } },
  };
  const a = generateCity("regional", 1, overrides);
  const block = baseline.plan.blocks[0].id;
  const b = generateCity("regional", 1, {
    ...overrides,
    blockSeeds: { [block]: "rebuild-2" },
  });
  assert.deepEqual(a.plan.streets, b.plan.streets);
  assert.deepEqual(a.plan.landmarks, b.plan.landmarks);
  assert.deepEqual(
    a.buildings.filter((p) => !p.parcelId.startsWith(block + "-")),
    b.buildings.filter((p) => !p.parcelId.startsWith(block + "-")),
  );
  assert.equal(
    b.buildings.find((p) => p.parcelId === hero.parcelId)?.name,
    "THE SAFEHOUSE",
  );
  assert.equal(
    b.buildings.find((p) => p.parcelId === hero.parcelId)?.floors,
    3,
  );
});

test("metropolis has materially greater area and density", () => {
  const c = generateCity("notebook");
  assert.equal(c.buildings.length, 256);
  assert.equal(c.plan.blocks.length, 64);
  assert.ok((c.bounds * 2) ** 2 / 180 ** 2 > 10);
  assert.ok(
    c.buildings.reduce((area, b) => area + b.w * b.d, 0) / (c.bounds * 2) ** 2 >
      0.48,
  );
  for (const block of c.plan.blocks) {
    const lots = c.plan.parcels.filter((p) => p.blockId === block.id);
    assert.equal(lots.length, 4);
    assert.equal(new Set(lots.map((p) => p.facing)).size, 2);
  }
});
