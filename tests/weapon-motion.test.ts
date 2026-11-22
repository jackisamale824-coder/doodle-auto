import test from "node:test";
import assert from "node:assert/strict";
import { buildWeapon } from "../src/actors.ts";
import { animateWeaponParts, reloadPose } from "../src/weapon-motion.ts";
import { disposeGroup } from "../src/render.ts";
import { ViewMotion } from "../src/motion.ts";
test("all reloads start and end neutral, move their loading parts, and reset on cancellation", () => {
  for (let weapon = 0; weapon < 4; weapon++) {
    const group = buildWeapon(weapon);
    try {
      for (const progress of [0, 1]) {
        const pose = reloadPose(weapon, progress);
        for (const value of Object.values(pose))
          assert.equal(Math.abs(value), 0);
      }
      const parts = group.userData.animatedParts;
      assert.ok(parts.length >= 2);
      animateWeaponParts(group, weapon, 0.4, 0);
      assert.ok(
        parts.some(
          (p: any) => p.position.distanceTo(p.userData.restPosition) > 0.01,
        ),
      );
      animateWeaponParts(group, weapon, 0, 0);
      for (const p of parts)
        assert.ok(p.position.distanceTo(p.userData.restPosition) < 1e-8);
    } finally {
      disposeGroup(group);
    }
  }
});
test("minor recoil remains bounded during automatic fire and settles after stopping", () => {
  for (let weapon = 0; weapon < 4; weapon++) {
    const v = new ViewMotion();
    for (let i = 0; i < 12; i++) {
      v.shot(weapon);
      assert.ok(v.kick <= 1.15);
      v.update(0.05, false, 8, true, false, 82);
    }
    for (let i = 0; i < 24; i++) v.update(1 / 120, false, 0, true, false, 82);
    assert.ok(v.kick < 0.02);
  }
});
