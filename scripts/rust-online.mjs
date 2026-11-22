import { WebSocket } from "ws";
import assert from "node:assert/strict";
const base = process.env.GAME_URL || "http://127.0.0.1:5183",
  sockets = [];
async function client(name) {
  const ws = new WebSocket(base.replace(/^http/, "ws") + "/ws", {
    origin: base,
  });
  sockets.push(ws);
  const messages = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    messages.push(m);
    if (m.type === "welcome")
      ws.send(
        JSON.stringify({
          type: "state",
          p: m.spawn,
          yaw: 0,
          pitch: 0,
          height: 1.76,
          weapon: 0,
          anchor: null,
        }),
      );
  });
  await new Promise((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  ws.send(JSON.stringify({ type: "public", name, mapScale: 1.21 }));
  return messages;
}
try {
  const health = await (await fetch(base + "/health")).json();
  assert.equal(health.level, "rust");
  const a = await client("Rust Verify A"),
    b = await client("Rust Verify B");
  await new Promise((r) => setTimeout(r, 2200));
  const aw = a.find((m) => m.type === "welcome"),
    bw = b.find((m) => m.type === "welcome");
  assert.ok(aw && bw);
  assert.equal(aw.code, bw.code);
  const snapshots = a.filter((m) => m.type === "snapshot"),
    last = snapshots.at(-1);
  assert.ok(last.players.some((p) => p.id === bw.id));
  assert.ok(last.players.some((p) => p.npc));
  assert.ok(
    last.players.every(
      (p) => Math.abs(p.p[0]) <= 120 && Math.abs(p.p[2]) <= 120,
    ),
  );
  console.log(
    JSON.stringify({
      level: health.level,
      room: aw.code,
      players: last.players.length,
      npcs: last.players.filter((p) => p.npc).length,
      snapshots: snapshots.length,
    }),
  );
} finally {
  for (const ws of sockets) ws.close();
}
