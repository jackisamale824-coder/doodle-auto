import test from "node:test";
import assert from "node:assert/strict";
import { blastDamage, launchBlast, obscured } from "../src/grenades.ts";
import { FRAG, ROCKET } from "../src/weapon-balance.ts";

test("grenade arcs and waits before bursting, rocket stops at its first collision", () => {
  const grenade = launchBlast(
    FRAG,
    [0, 3, 0],
    [0, 0, -1],
    () => null,
    1000,
    "one",
  );
  assert.ok(grenade.flight!.path.some((p) => p[1] > 3));
  assert.ok(grenade.flight!.impact > grenade.flight!.arrival);
  const rocket = launchBlast(
    ROCKET,
    [0, 3, 0],
    [0, 0, -1],
    () => ({ distance: 2 }),
    1000,
    "one",
  );
  assert.deepEqual(rocket.p, [0, 3, -1.92]);
  assert.equal(rocket.flight!.impact, rocket.flight!.arrival);
  assert.ok(blastDamage(rocket, [0, 2, -2], 1.7, () => null) > 0);
  assert.equal(
    blastDamage(rocket, [0, 2, -2], 1.7, () => ({ distance: 0.02 })),
    0,
  );
  assert.equal(
    blastDamage(rocket, [10, 2, -2], 1.7, () => null),
    0,
  );
  assert.equal(
    obscured([rocket, grenade], [0, 3, 0], [0, 3, -10], 1010),
    false,
  );
});
