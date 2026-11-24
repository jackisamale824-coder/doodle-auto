import test from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { Doodle } from "../src/actors.ts";
import {
  carBodyHit,
  CountyRagdolls,
  KNOCKDOWN_TIME,
  stepKnockback,
} from "../src/county-ragdoll.ts";
import { Physics } from "../src/physics.ts";
import { worldRay, type Box, type V3 } from "../src/world.ts";

const ground: Box = {
  p: [0, -0.5, 0],
  s: [50, 1, 50],
  kind: "ground",
  solid: true,
};

test("the swept car body catches bumper and reverse hits across ticks and respects orientation and height", () => {
  const fast = carBodyHit([0, 0, 8], [0, 0, -8], 0, 32, [0.8, 0, 0])!;
  const slow = carBodyHit([0, 0, 8], [0, 0, -8], 0, 5, [0.8, 0, 0])!;
  assert.ok(fast.damage >= 100 && slow.damage > 0 && slow.damage < 100);
  assert.ok(
    fast.impulse[2] < slow.impulse[2] &&
      fast.impulse[1] > 0 &&
      fast.impulse[0] > 0,
  );
  assert.ok(
    carBodyHit([0, 0, 0], [0, 0, 0.1], 0, -9, [0, 0, 2.5])!.impulse[2] > 0,
  );
  assert.equal(
    carBodyHit([0, 0, 0], [0, 0, 0.1], Math.PI / 2, 9, [0, 0, 2.5]),
    null,
  );
  assert.equal(carBodyHit([0, 0, 8], [0, 0, -8], 0, 32, [1.75, 0, 0]), null);
  assert.equal(carBodyHit([0, 0, 8], [0, 0, -8], 0, 32, [0, 2.2, 0]), null);
  assert.equal(carBodyHit([0, 3, 8], [0, 3, -8], 0, 32, [0, 0, 0]), null);
  assert.ok(carBodyHit([0, 0, 8], [0, 0, -8], 0, 32, [0, 1.8, 0], "delivery"));
  assert.equal(
    carBodyHit([0, 0, 8], [0, 0, -8], 0, 32, [0, 1.8, 0], "coupe"),
    null,
  );
  assert.equal(carBodyHit([0, 0, 0], [0, 0, 0], 0, 9, [0, 0, 0]), null);
  assert.equal(carBodyHit([0, 0, 0], [0, 0, 0.05], 0, 1, [0, 0, 0]), null);
});

test("knockback root arcs, stops before a thin wall and lands on an elevated floor", () => {
  const boxes: Box[] = [
    { ...ground, p: [0, 0.5, 0] },
    { p: [2, 3, 0], s: [0.05, 6, 8], kind: "wall", solid: true },
  ];
  const ray = (o: V3, d: V3, n: number) => worldRay(boxes, o, d, n);
  const p: V3 = [0, 1, 0],
    v: V3 = [10, 4, 0];
  stepKnockback(p, v, 0.12, ray);
  assert.ok(p[0] > 0.9 && p[1] > 1.2);
  let landed = false;
  for (let i = 0; i < 30; i++) landed = stepKnockback(p, v, 0.05, ray);
  assert.ok(landed && p[0] > 1.6 && p[0] < 1.75);
  assert.ok(Math.abs(p[1] - 1) < 0.001 && Math.hypot(...v) < 0.001);
});

test("real rig joints tumble against moved rubble, retain segment length and recover at the authoritative root", async () => {
  const boxes: Box[] = [
    ground,
    { p: [15, 1.5, 0], s: [0.18, 3, 7], kind: "slab", solid: false },
  ];
  const physics = await Physics.create(boxes);
  const initialColliders = physics.world.colliders.len();
  const model = new Doodle("#337055", undefined, "civilian");
  const dolls = new CountyRagdolls(physics);
  const eye = new Vector3(0, 1.7, 4);
  let p: V3 = [0, 0, 0],
    v: V3 = [10, 4.4, 0],
    minHead = 10,
    maxBend = 0;
  physics.addRubble({
    id: 1,
    indices: [1],
    pose: {
      id: 1,
      origin: [15, 1.5, 0],
      p: [2.3, 1.5, 0],
      q: [0, 0, 0, 1],
      sleep: true,
    },
  });
  const ray = (o: V3, d: V3, n: number) =>
    physics.ray(new Vector3(...o), new Vector3(...d), n);
  try {
    assert.ok(dolls.hit(model, v, eye));
    for (let i = 0; i < 61; i++) {
      stepKnockback(p, v, 1 / 30, ray);
      model.group.position.fromArray(p);
      dolls.update(1 / 30, eye);
      const head = model.head.getWorldPosition(new Vector3());
      const knee = model.leftKnee.getWorldPosition(new Vector3()),
        foot = model.leftFoot.getWorldPosition(new Vector3());
      assert.ok(
        head.x < 2.26 && foot.x < 2.27,
        `limbs crossed the slab at frame ${i}`,
      );
      assert.ok(
        head.y > 0.14 && foot.y > -0.07,
        `limb below ground at frame ${i}`,
      );
      assert.ok(Math.abs(knee.distanceTo(foot) - 0.29) < 0.00001);
      assert.ok(Math.hypot(head.x - p[0], head.z - p[2]) < 1.85);
      minHead = Math.min(minHead, head.y);
      maxBend = Math.max(
        maxBend,
        model.leftKnee.quaternion.angleTo(model.rightKnee.quaternion),
        Math.abs(model.leftKnee.rotation.x),
        Math.abs(model.leftKnee.rotation.z),
      );
    }
    assert.ok(
      minHead < 1.06 && maxBend > 0.22,
      `head ${minHead} knee ${maxBend}`,
    );
    assert.ok(p[0] > 1.5 && p[0] < 2.1);
    dolls.update(0.25, eye);
    assert.equal(dolls.has(model), false);
    assert.deepEqual(model.group.position.toArray(), p);
    assert.equal(model.group.visible, true);
    assert.ok(model.head.getWorldPosition(new Vector3()).y > 1.5);
    assert.equal(physics.world.colliders.len(), initialColliders);
    assert.equal(model.aimRig.visible, false);
  } finally {
    dolls.dispose();
    model.dispose();
    physics.dispose();
  }
});

test("late observers see a prone body; range, capacity and death retirement bound its lifetime", () => {
  const dolls = new CountyRagdolls({ ray: () => null });
  const actors = Array.from({ length: 8 }, (_, i) => {
    const a = new Doodle();
    a.group.position.x = i;
    return a;
  });
  const eye = new Vector3();
  try {
    for (const a of actors) dolls.hit(a, [7, 3, 0], eye, true, 0.8);
    assert.equal(actors.filter((a) => dolls.has(a)).length, 6);
    assert.ok(actors[0].head.getWorldPosition(new Vector3()).y < 0.6);
    assert.equal(
      dolls.hit(actors[7], [4, 2, 0], new Vector3(100, 0, 0)),
      false,
    );
    dolls.update(KNOCKDOWN_TIME, eye);
    assert.equal(actors.filter((a) => dolls.has(a)).length, 0);
    assert.equal(actors[0].group.visible, false);
    actors[0].fall(1 / 60);
    assert.equal(actors[0].group.visible, false);
    assert.ok(dolls.hit(actors[6], [4, 2, 0], eye));
    dolls.update(1 / 30, new Vector3(100, 0, 0));
    assert.equal(dolls.has(actors[6]), false);
  } finally {
    dolls.dispose();
    actors.forEach((a) => a.dispose());
  }
});

test("witnesses raise a hand to call and only police draw a weapon", () => {
  const citizen = new Doodle("#45818c", undefined, "civilian");
  const police = new Doodle("#17395c", undefined, "police");
  const camera = new PerspectiveCamera();
  try {
    citizen.setCivilianAction("calling");
    citizen.animate(0, 4, camera, 0, 1 / 60);
    assert.ok(citizen.rightElbow.rotation.x < -2);
    citizen.setCivilianAction("shoot");
    assert.equal(citizen.aimRig.visible, false);
    assert.equal(police.aimRig.visible, false);
    police.setCivilianAction("shoot");
    assert.equal(police.aimRig.visible, true);
    police.setCivilianAction("idle");
    assert.equal(police.aimRig.visible, false);
  } finally {
    citizen.dispose();
    police.dispose();
  }
});

test("free tumbles land with head clearance and give the same joints at 30 and 120 fps", async () => {
  const physics = await Physics.create([ground]);
  const sim = (rate: number) => {
    const m = new Doodle(),
      dolls = new CountyRagdolls(physics);
    const p: V3 = [0, 0, 0],
      v: V3 = [5, 3.4, 2],
      eye = new Vector3(0, 2, 0);
    try {
      dolls.hit(m, v, eye);
      for (let i = 0; i < rate; i++) {
        // The authoritative simulation publishes a new root at 30 Hz.
        if (i % (rate / 30) === 0)
          stepKnockback(p, v, 1 / 30, (o, d, n) =>
            physics.ray(new Vector3(...o), new Vector3(...d), n),
          );
        m.group.position.fromArray(p);
        dolls.update(1 / rate, eye);
      }
      const head = m.head.getWorldPosition(new Vector3()),
        hand = m.rightHand.getWorldPosition(new Vector3());
      assert.ok(head.y > 0.2 && head.y < 0.45, `landed head center: ${head.y}`);
      dolls.markDead(m);
      dolls.update(KNOCKDOWN_TIME, eye);
      assert.equal(m.group.visible, false);
      return [head, hand];
    } finally {
      dolls.dispose();
      m.dispose();
    }
  };
  try {
    const a = sim(30),
      b = sim(120);
    assert.ok(a.every((p, i) => p.distanceTo(b[i]) < 1e-8));
  } finally {
    physics.dispose();
  }
});
