import { WebSocket } from "ws";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const origin = process.env.GAME_URL || "https://doodlescreed.cutslop.com";
const endpoint = origin.replace(/^http/, "ws") + "/ws";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function client() {
  const ws = new WebSocket(endpoint);
  const inbox = [];
  ws.on("message", (raw) => inbox.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return { ws, inbox };
}
async function until(fn) {
  for (let i = 0; i < 160; i++) {
    const r = fn();
    if (r) return r;
    await pause(50);
  }
  throw Error("Timed out waiting for server message");
}
const a = await client(),
  b = await client();
const send = (c, m) => c.ws.send(JSON.stringify(m));
try {
  send(a, { type: "create", name: "Smoke shooter", seed: "paper" });
  const wa = await until(() => a.inbox.find((m) => m.type === "welcome"));
  send(b, { type: "join", name: "Smoke target", code: wa.code });
  const wb = await until(() => b.inbox.find((m) => m.type === "welcome"));
  // Positions are explicit protocol fixtures; health, hit tests and scores are real server behavior.
  const place = async (c, start, target) => {
    let p = [...start];
    for (let i = 0; i < 100; i++) {
      const delta = target.map((v, j) => v - p[j]),
        len = Math.hypot(...delta);
      if (len < 0.01) break;
      p = p.map((v, j) => v + delta[j] * Math.min(1, 5 / len));
      await pause(120);
      send(c, { type: "state", p, yaw: 0, pitch: 0, weapon: 0, height: 1.76 });
    }
  };
  await place(a, wa.spawn, [15, 0.1, 20]);
  await place(b, wb.spawn, [15, 0.1, 10]);
  await pause(3200);
  const positioned = a.inbox.filter((m) => m.type === "snapshot").at(-1);
  assert.ok(
    Math.abs(positioned.players.find((p) => p.id === wa.id).p[2] - 20) < 0.01,
  );
  assert.ok(
    Math.abs(positioned.players.find((p) => p.id === wb.id).p[2] - 10) < 0.01,
  );
  a.inbox.length = 0;
  for (let i = 0; i < 5; i++) {
    send(a, { type: "fire" });
    await pause(150);
  }
  const won = await until(() =>
    a.inbox.find(
      (m) =>
        m.type === "snapshot" &&
        m.players.find((p) => p.id === wa.id)?.kills === 1,
    ),
  );
  assert.equal(won.players.find((p) => p.id === wb.id).hp, 0);
  assert.equal(won.players.find((p) => p.id === wb.id).deaths, 1);
  assert.ok(a.inbox.some((m) => m.type === "hit" && m.kill));
  await pause(2300);
  send(b, { type: "respawn" });
  assert.ok(await until(() => b.inbox.find((m) => m.type === "respawn")));
  const result = {
    origin,
    checks: [
      "Two public WSS clients join one room",
      "Server validates shots and replicates a kill, damage and score",
      "Eliminated player respawns",
    ],
    errors: [],
  };
  await writeFile(
    "output/playwright/public-combat-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  a.ws.close();
  b.ws.close();
}
