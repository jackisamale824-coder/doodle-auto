import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket, WebSocketServer } from "ws";
import { Rooms } from "../server/rooms.ts";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
function message(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Error(type)), 5000);
    const read = (raw: any) => {
      const m = JSON.parse(String(raw));
      if (m.type === type) {
        clearTimeout(t);
        ws.off("message", read);
        resolve(m);
      }
    };
    ws.on("message", read);
  });
}
test("Duel matches real players with no NPCs and lobby occupancy follows live connections", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss),
    clients: WebSocket[] = [];
  const join = async (type: string) => {
    const ws = new WebSocket(`ws://localhost:${(wss.address() as any).port}`);
    clients.push(ws);
    await new Promise((r) => ws.on("open", r));
    const next = message(ws, "welcome");
    ws.send(JSON.stringify({ type, name: "Tester" }));
    return { ws, welcome: await next };
  };
  try {
    assert.deepEqual(rooms.lobbies(), []);
    const a = await join("duel"),
      b = await join("duel");
    assert.equal(a.welcome.code, b.welcome.code);
    assert.equal(a.welcome.duel, true);
    const duel = rooms.rooms.get(a.welcome.code)!;
    assert.equal(duel.ai, null);
    assert.deepEqual(duel.npcs, []);
    const snapshot = await message(a.ws, "snapshot");
    assert.equal(snapshot.players.length, 2);
    assert.ok(snapshot.players.every((p: any) => !p.npc));
    assert.deepEqual(
      rooms.lobbies().map((r) => [r.mode, r.players]),
      [["duel", 2]],
    );
    const normal = await join("public");
    assert.notEqual(normal.welcome.code, a.welcome.code);
    assert.ok(rooms.rooms.get(normal.welcome.code)!.ai);
    a.ws.close();
    b.ws.close();
    for (
      let i = 0;
      i < 50 && rooms.lobbies().some((r) => r.mode === "duel");
      i++
    )
      await wait(10);
    assert.ok(!rooms.lobbies().some((r) => r.mode === "duel"));
    normal.ws.close();
    for (let i = 0; i < 50 && rooms.lobbies().length; i++) await wait(10);
    assert.deepEqual(
      rooms.lobbies(),
      [],
      "NPCs and empty rooms cannot keep a lobby active",
    );
  } finally {
    clients.forEach((ws) => ws.close());
    rooms.dispose();
    wss.close();
  }
});

test("accepted Duel respawn heals survivors, not other dead players; rejected requests and other modes do not heal", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss),
    clients: WebSocket[] = [];
  try {
    let code = "";
    for (let i = 0; i < 3; i++) {
      const ws = new WebSocket(`ws://localhost:${(wss.address() as any).port}`);
      clients.push(ws);
      await new Promise((r) => ws.on("open", r));
      const ready = message(ws, "welcome");
      ws.send(JSON.stringify({ type: "duel", name: `Player ${i}` }));
      code = (await ready).code;
    }
    const room = rooms.rooms.get(code)!;
    const [[socket, respawning], [, survivor], [, dead]] = [
      ...room.players.entries(),
    ];
    survivor.hp = 27;
    survivor.mags[0] = 9;
    survivor.kills = 3;
    dead.hp = 0;
    // A living player's request and an early death request cannot heal others.
    rooms.handle(socket, { type: "respawn" });
    assert.equal(survivor.hp, 27);
    respawning.hp = 0;
    respawning.deadAt = Date.now();
    rooms.handle(socket, { type: "respawn" });
    assert.equal(survivor.hp, 27);
    respawning.deadAt = Date.now() - 3000;
    room.duel = false;
    rooms.handle(socket, { type: "respawn" });
    assert.equal(survivor.hp, 27, "other modes retain survivor health");
    room.duel = true;
    respawning.hp = 0;
    respawning.deadAt = Date.now() - 3000;
    rooms.handle(socket, { type: "respawn" });
    assert.equal(respawning.hp, 100);
    assert.equal(survivor.hp, 100);
    assert.equal(dead.hp, 0);
    assert.equal(survivor.mags[0], 9);
    assert.equal(survivor.kills, 3);
    const snapshot = await message(clients[1], "snapshot");
    assert.equal(
      snapshot.players.find((p: any) => p.id === survivor.id).hp,
      100,
    );
  } finally {
    clients.forEach((ws) => ws.close());
    rooms.dispose();
    wss.close();
  }
});
