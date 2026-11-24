import test from "node:test";
import assert from "node:assert/strict";
import {
  rack,
  strike,
  step,
  settle,
  canPlace,
  copyMatch,
  type Match,
} from "../src/pool/game.ts";
import { botStroke, predict } from "../src/pool/aim.ts";

function play(m: Match, s = botStroke(m)) {
  const shot = strike(m, s);
  assert.ok(shot);
  let ticks = 0;
  while (step(m, shot)) assert.ok(++ticks < 3000);
  settle(m, shot);
  return shot;
}
test("prediction preserves rack and agrees with the break contact", () => {
  const m = rack(),
    before = copyMatch(m),
    s = { angle: 0, power: 0.95 };
  const guide = predict(m, s);
  assert.deepEqual(m, before);
  assert.ok(guide.line.length > 1);
  assert.ok(Math.abs(guide.line.at(-1)!.x - 630) < 5);
  assert.equal(play(m, s).first, 1);
  assert.ok(m.balls.filter((b, i) => b.x !== before.balls[i].x).length > 8);
});
test("scratch returns the cue and ball-in-hand rejects overlapping placement", () => {
  const m = rack();
  m.balls[0].x = 450;
  m.balls[0].y = 50;
  const shot = play(m, { angle: -Math.PI / 2, power: 0.6 });
  assert.deepEqual(shot.drops, [0]);
  assert.ok(m.hand);
  assert.equal(m.turn, 1);
  assert.ok(!m.balls[0].down);
  assert.ok(canPlace(m, m.balls[0].x, m.balls[0].y));
  assert.equal(
    strike(m, { angle: 0, power: 1, x: m.balls[1].x, y: m.balls[1].y }),
    null,
  );
});
test("sinking the eight is a win only when it was the legal target; break eight is spotted", () => {
  for (const result of ["legal", "early", "scratch", "break"]) {
    const m = rack();
    m.groups = ["Solids", "Stripes"];
    m.shots = result === "break" ? 0 : 4;
    for (const b of m.balls) b.down = b.id !== 0 && b.id !== 8;
    if (result === "early") m.balls[1].down = false;
    const shot = strike(m, { angle: 0, power: 1 })!;
    shot.first = 8;
    shot.drops = [8];
    if (result === "scratch") shot.drops.push(0);
    m.balls[8].down = true;
    settle(m, shot);
    if (result === "break") {
      assert.equal(m.winner, null);
      assert.equal(m.balls[8].down, false);
    } else assert.equal(m.winner, result === "legal" ? 0 : 1);
  }
});
test("house players finish a full rack from the opening break", () => {
  const m = rack();
  while (m.winner === null && m.shots < 120) play(m);
  assert.notEqual(m.winner, null);
  assert.ok(m.balls[8].down);
  assert.ok(m.groups[0] && m.groups[1]);
  assert.equal(m.message, "Eight ball sunk");
});
