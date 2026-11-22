import test from "node:test";
import assert from "node:assert/strict";
import {
  hiddenNpcSpawn,
  outsideNpcRadius,
  chooseNpcSpawn,
} from "../src/npc-presence.ts";
import { Waves } from "../src/waves.ts";
const observer = {
  p: [0, 0, 0] as [number, number, number],
  eye: [0, 1.6, 0] as [number, number, number],
};
test("spawns require nearby cover over the entire body and are hidden from every nearby player", () => {
  assert.equal(
    hiddenNpcSpawn([30, 0, 0], [observer], () => true),
    true,
  );
  assert.equal(
    hiddenNpcSpawn([30, 0, 0], [observer], () => false),
    false,
  );
  assert.equal(
    hiddenNpcSpawn([30, 0, 0], [observer], (_, p) => p[1] < 1.5),
    false,
  );
  assert.equal(
    hiddenNpcSpawn([10, 0, 0], [observer], () => true),
    false,
  );
  assert.equal(
    hiddenNpcSpawn([70, 0, 0], [observer], () => true),
    false,
  );
  const other = {
    p: [30, 0, 30] as [number, number, number],
    eye: [30, 1.6, 30] as [number, number, number],
  };
  assert.equal(
    hiddenNpcSpawn([30, 0, 0], [observer, other], (eye) => eye[2] === 0),
    false,
  );
  assert.equal(outsideNpcRadius([150, 0, 0], [observer]), true);
  assert.equal(
    outsideNpcRadius(
      [150, 0, 0],
      [observer, { p: [155, 0, 0], eye: [155, 1.6, 0] }],
    ),
    false,
  );
  assert.equal(
    chooseNpcSpawn(
      [[30, 0, 0]],
      [0],
      [observer],
      [],
      0,
      () => false,
      () => true,
    ),
    null,
  );
});
test("blocked spawn retries keep queued enemies and recycling does not complete a wave", () => {
  const w = new Waves();
  w.spawned--;
  w.update(2, 3, () => false);
  assert.equal(w.queued, 1);
  assert.equal(w.number, 1);
  w.update(2, 3, () => true);
  assert.equal(w.queued, 0);
});

test("real city NPCs spawn behind cover, cull outside all player radii and retain wave totals", async () => {
  const { generateCity, distance } = await import("../src/world.ts");
  const { Spatial } = await import("../server/spatial.ts");
  const { Npcs } = await import("../server/npcs.ts");
  const city = generateCity("notebook"),
    spatial = new Spatial(city.boxes),
    ai = new Npcs(city, spatial);
  const start = city.spawns[0];
  const o = {
    p: start,
    eye: [start[0], start[1] + 1.6, start[2]] as [number, number, number],
  };
  assert.equal(ai.actors.length, 4);
  for (const bot of ai.actors)
    assert.ok(
      hiddenNpcSpawn(bot.p, [o], (eye, to) => {
        const len = distance(eye, to);
        return !!spatial.ray(
          eye,
          to.map((v, i) => (v - eye[i]) / len) as any,
          len - 0.2,
        );
      }),
    );
  const old = new Set(ai.actors.map((b) => b.id));
  const far =
    city.nodes[
      city.streetNodes.find((i) => distance(city.nodes[i], start) > 220)!
    ];
  const player = {
    p: far,
    hp: 100,
    height: 1.76,
    shieldUntil: Infinity,
  } as any;
  const keeper = {
    p: [...ai.actors[0].p],
    hp: 100,
    height: 1.76,
    shieldUntil: Infinity,
  } as any;
  const kept = ai.actors[0].id;
  ai.update(
    0.1,
    Date.now(),
    [player, keeper],
    () => {},
    () => {},
  );
  assert.ok(
    ai.actors.some((b) => b.id === kept),
    "must retain NPC near another player",
  );
  ai.update(
    0.1,
    Date.now(),
    [player],
    () => {},
    () => {},
  );
  assert.ok(
    ai.actors.every((b) => !old.has(b.id)),
    "far NPCs must be removed",
  );
  assert.equal(ai.actors.filter((b) => b.hp > 0).length + ai.waves.queued, 4);
  assert.equal(ai.waves.number, 1);
  assert.equal(ai.waves.nextIn, 0);
  assert.ok(ai.actors.every((b) => distance(b.p, far) <= 100));
});

test("Rust mesh bounds do not block clear navigation nodes or wave spawning", async () => {
  const { generateRust } = await import("../src/rust.ts");
  const { Spatial } = await import("../server/spatial.ts");
  const { Npcs } = await import("../server/npcs.ts");
  const city = generateRust(),
    spatial = new Spatial(city.boxes);
  const ai = new Npcs(city, spatial);
  assert.equal(ai.actors.length, 4);
  assert.equal(ai.waves.queued, 0);
  for (const bot of ai.actors) assert.ok(spatial.clear(bot.p));
  ai.actors.forEach((b) => (b.hp = 0));
  const p = {
    p: city.spawns[0],
    hp: 100,
    height: 1.76,
    shieldUntil: Infinity,
  } as any;
  ai.update(
    6,
    Date.now(),
    [p],
    () => {},
    () => {},
  );
  for (let i = 0; i < 20; i++)
    ai.update(
      0.5,
      Date.now() + i * 500,
      [p],
      () => {},
      () => {},
    );
  assert.equal(ai.waves.number, 2);
  assert.equal(ai.actors.length, 7);
});

test("Rust has hidden clear spawn candidates around every player entry", async () => {
  const { generateRust } = await import("../src/rust.ts");
  const { Spatial } = await import("../server/spatial.ts");
  const { distance } = await import("../src/world.ts");
  const c = generateRust(),
    s = new Spatial(c.boxes);
  for (const p of c.spawns) {
    const observers = [
      { p, eye: [p[0], p[1] + 1.6, p[2]] as [number, number, number] },
    ];
    let candidate: number | null = null;
    for (
      let offset = 0;
      offset < c.nodes.length && candidate === null;
      offset += 96
    )
      candidate = chooseNpcSpawn(
        c.nodes,
        c.nodes.map((_, i) => i),
        observers,
        [],
        offset,
        (a, b) => {
          const len = distance(a, b);
          return !!s.ray(
            a,
            b.map((v, i) => (v - a[i]) / len) as any,
            len - 0.2,
          );
        },
        (p) => s.clear(p),
      );
    assert.notEqual(candidate, null, `no covered spawn near ${p}`);
  }
});

test("mesh clearance rejects actual surfaces without filling empty mesh bounds", async () => {
  const { meshOverlapsBox } = await import("../src/mesh-collision.ts");
  const mesh = { vertices: [-5, 0, -5, 5, 0, -5, 0, 0, 5], indices: [0, 1, 2] };
  assert.equal(meshOverlapsBox(mesh, [0, 1, 0], [0.3, 0.5, 0.3]), false);
  assert.equal(meshOverlapsBox(mesh, [0, 0, 0], [0.3, 0.5, 0.3]), true);
  assert.equal(meshOverlapsBox(mesh, [4, 0, 4], [0.3, 0.5, 0.3]), false);
});
