import assert from "node:assert/strict";
import { generateRust } from "../src/rust.ts";
import { Spatial } from "../server/spatial.ts";
import { Npcs } from "../server/npcs.ts";
import { distance } from "../src/world.ts";
const c = generateRust(),
  s = new Spatial(c.boxes),
  ai = new Npcs(c, s);
const p = {
  id: "check",
  p: c.spawns[0],
  hp: 100,
  height: 1.76,
  shieldUntil: 0,
} as any;
let shots = 0,
  damage = 0,
  overlaps = 0;
const start = Date.now(),
  initial = ai.actors.map((b) => distance(b.p, p.p));
for (let frame = 0; frame < 1800; frame++) {
  ai.update(
    1 / 30,
    start + (frame * 1000) / 30,
    [p],
    (_p, _b, d) => (damage += d),
    () => shots++,
  );
  if (frame % 30 === 0)
    for (let i = 0; i < ai.actors.length; i++)
      for (let j = i + 1; j < ai.actors.length; j++)
        if (distance(ai.actors[i].p, ai.actors[j].p) < 0.6) overlaps++;
}
console.log({
  initial,
  final: ai.actors.map((b) => ({
    p: b.p,
    d: distance(b.p, p.p),
    path: b.path.length,
  })),
  shots,
  damage,
  overlaps,
});

assert.equal(overlaps, 0, "NPCs must not stack");
assert.ok(shots > 0, "NPCs must reach an engagement position");
assert.ok(
  damage > 0 && damage < shots * ai.waves.settings.damage,
  "shots should include both hits and misses",
);
assert.ok(
  ai.actors.every((b) => distance(b.p, p.p) > 2 && distance(b.p, p.p) < 25),
  "NPCs should hold combat distance",
);
