import test from "node:test";
import assert from "node:assert/strict";
import { Doodle } from "../src/actors.ts";
import { PerspectiveCamera, Vector3 } from "three";
test("head and barrel follow aim pitch, with muzzle facing forward", () => {
  const d = new Doodle(),
    camera = new PerspectiveCamera();
  try {
    for (let i = 0; i < 60; i++) d.animate(i / 60, 0, camera, 0.5, 1 / 60);
    d.group.updateMatrixWorld(true);
    const forward = new Vector3(0, 0, 1).transformDirection(
      d.aimRig.matrixWorld,
    );
    assert.ok(forward.y > 0.45 && forward.z > 0.8);
    assert.ok(Math.abs(d.head.rotation.x - d.aimRig.rotation.x) < 0.001);
    assert.ok(d.group.getObjectByName("muzzle"));
  } finally {
    d.dispose();
  }
});
test("walking phase is driven by distance and settles at rest without packet kicks", () => {
  const d = new Doodle(),
    c = new PerspectiveCamera();
  try {
    const angles: number[] = [];
    for (let i = 0; i < 120; i++) {
      d.animate(i / 60, 3, c, 0, 1 / 60);
      angles.push(d.leftLeg.rotation.x);
    }
    assert.ok(Math.max(...angles) > 0.2 && Math.min(...angles) < -0.2);
    assert.ok(angles.slice(1).every((x, i) => Math.abs(x - angles[i]) < 0.1));
    for (let i = 0; i < 60; i++) d.animate(2 + i / 60, 0, c, 0, 1 / 60);
    assert.ok(Math.abs(d.leftLeg.rotation.x) < 0.001);
  } finally {
    d.dispose();
  }
});

test("joint hierarchy keeps hands on grips and recoil recovers", () => {
  const d = new Doodle(),
    camera = new PerspectiveCamera();
  try {
    assert.equal(d.leftElbow.parent, d.leftArm);
    assert.equal(d.leftKnee.parent, d.leftLeg);
    assert.equal(d.head.parent, d.spine);
    for (const pitch of [-0.4, 0, 0.4]) {
      for (let i = 0; i < 90; i++) d.animate(i / 60, 3, camera, pitch, 1 / 60);
      d.group.updateMatrixWorld(true);
      const target = new Vector3(0, -0.035, 0.03).applyMatrix4(
        d.aimRig.matrixWorld,
      );
      assert.ok(
        d.rightHand.getWorldPosition(new Vector3()).distanceTo(target) < 0.015,
      );
      const leftTarget = new Vector3(-0.025, -0.025, 0.23).applyMatrix4(
        d.aimRig.matrixWorld,
      );
      assert.ok(
        d.leftHand.getWorldPosition(new Vector3()).distanceTo(leftTarget) <
          0.08,
      );
    }
    d.fire();
    d.animate(2, 0, camera, 0, 1 / 60);
    assert.ok(d.aimRig.position.z < 0.1);
    for (let i = 0; i < 60; i++) d.animate(2 + i / 60, 0, camera, 0, 1 / 60);
    assert.ok(Math.abs(d.aimRig.position.z - 0.12) < 0.001);
  } finally {
    d.dispose();
  }
});

test("hit reactions affect the selected joint, remain bounded and settle", () => {
  const camera = new PerspectiveCamera();
  for (const region of ["head", "body", "arm", "leg"] as const) {
    const d = new Doodle();
    try {
      d.animate(0, 0, camera, 0, 1 / 60);
      const before = d.leftArm.quaternion.clone();
      for (let i = 0; i < 20; i++) d.react(region, -1, 100);
      d.animate(0, 0, camera, 0, 1 / 60);
      if (region === "head") assert.ok(d.head.rotation.z < -0.1);
      if (region === "body") assert.ok(d.spine.rotation.x < -0.05);
      if (region === "arm")
        assert.ok(d.leftArm.quaternion.angleTo(before) > 0.1);
      if (region === "leg") assert.ok(d.leftKnee.rotation.x > 0.1);
      assert.equal(d.group.position.length(), 0);
      for (let i = 0; i < 60; i++) d.animate(i / 60, 0, camera, 0, 1 / 60);
      assert.ok(Math.abs(d.head.rotation.z) < 0.001);
      assert.ok(Math.abs(d.spine.rotation.x) < 0.001);
      assert.ok(Math.abs(d.leftKnee.rotation.x) < 0.001);
      assert.ok(Math.abs(d.pelvis.position.y) < 0.001);
    } finally {
      d.dispose();
    }
  }
});

test("punches recoil through the head, hips and planted leg, then recover even with repeated snapshots", () => {
  for (const role of ["civilian", "combatant"] as const) {
    const model = new Doodle(undefined, undefined, role),
      cam = new PerspectiveCamera();
    try {
      const reaction = {
        at: 1000,
        move: 2,
        region: "head" as const,
        side: 1,
        lateral: 0.6,
        forward: -0.8,
      };
      for (let i = 1; i <= 48; i++) {
        model.reactToPunch(reaction, 1000 + (i * 1000) / 60);
        model.animate(i / 60, 0, cam, 0, 1 / 60);
        if (i === 5) {
          assert.ok(Math.abs(model.head.rotation.x) > 0.2);
          assert.ok(Math.abs(model.spine.rotation.y) > 0.2);
          assert.ok(model.rightKnee.rotation.x > 0.1);
          assert.ok(model.pelvis.position.z < 0);
        }
      }
      assert.equal(model.pelvis.position.length(), 0);
      assert.equal(model.rightKnee.rotation.x, 0);
      assert.equal(model.group.position.length(), 0);
    } finally {
      model.dispose();
    }
  }
});
