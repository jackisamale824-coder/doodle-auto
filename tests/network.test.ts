import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket, WebSocketServer } from "ws";
import { Rooms } from "../server/rooms.ts";
function next(ws: WebSocket, type: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", read);
      reject(Error("No " + type));
    }, 3000);
    function read(raw: any) {
      const m = JSON.parse(String(raw));
      if (m.type === type) {
        clearTimeout(timer);
        ws.off("message", read);
        resolve(m);
      }
    }
    ws.on("message", read);
  });
}
async function client(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise((r) => ws.on("open", r));
  return ws;
}
test("real websocket clients join the same city and invalid rooms return a useful error", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss);
  const port = (wss.address() as any).port;
  const a = await client(port),
    b = await client(port);
  try {
    const ready = next(a, "welcome");
    a.send(JSON.stringify({ type: "create", name: "Alice", seed: "paper" }));
    const room = await ready;
    assert.equal(room.seed, "paper");
    assert.match(room.code, /^[A-Z0-9]{5}$/);
    const err = next(b, "error");
    b.send(JSON.stringify({ type: "join", code: "XXXXX", name: "Bob" }));
    assert.match((await err).message, /exist/i);
    const joined = next(b, "welcome");
    b.send(JSON.stringify({ type: "join", code: room.code, name: "Bob" }));
    const data = await joined;
    assert.equal(data.seed, room.seed);
    assert.notEqual(data.id, room.id);
    const snapshot = await next(a, "snapshot");
    assert.equal(snapshot.players.length, 2);
    const closed = next(a, "snapshot");
    b.close();
    await closed;
    await new Promise((r) => setTimeout(r, 80));
    assert.equal((await next(a, "snapshot")).players.length, 1);
  } finally {
    a.close();
    b.close();
    rooms.dispose();
    wss.close();
  }
});
test("the server owns damage and scores, rejects client-specified damage and blocks shots through buildings", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss),
    port = (wss.address() as any).port,
    a = await client(port),
    b = await client(port);
  try {
    const ra = next(a, "welcome");
    a.send(JSON.stringify({ type: "create", name: "Alice", seed: "paper" }));
    const welcome = await ra;
    const rb = next(b, "welcome");
    b.send(JSON.stringify({ type: "join", name: "Bob", code: welcome.code }));
    await rb;
    const room = rooms.rooms.get(welcome.code)!;
    const [shooter, victim] = [...room.players.values()];
    shooter.p = [15, 0.1, 20];
    victim.p = [15, 0.1, 10];
    shooter.yaw = 0;
    shooter.pitch = 0;
    victim.shieldUntil = 0;
    a.send(
      JSON.stringify({ type: "damage", target: victim.id, amount: 99999 }),
    );
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(victim.hp, 100);
    const hit = next(a, "hit");
    a.send(JSON.stringify({ type: "fire", amount: 99999 }));
    await hit;
    assert.ok(victim.hp > 0 && victim.hp < 100);
    const hp = victim.hp;
    a.send(JSON.stringify({ type: "fire" }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(
      victim.hp,
      hp,
      "fire-rate limit must reject rapid repeat shots",
    );
    for (let i = 0; i < 5 && victim.hp > 0; i++) {
      await new Promise((r) => setTimeout(r, 125));
      a.send(JSON.stringify({ type: "fire" }));
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(victim.hp, 0);
    assert.equal(shooter.kills, 1);
    assert.equal(victim.deaths, 1);
    const building = room.city.buildings[12],
      wallX = building.x - building.w / 2 + 0.18;
    victim.hp = 100;
    victim.p = [wallX, 0.1, -15];
    shooter.p = [wallX, 0.1, 15];
    shooter.lastShot = 0;
    a.send(JSON.stringify({ type: "fire" }));
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(
      victim.hp,
      100,
      "front and rear walls block a shot through the building",
    );
  } finally {
    a.close();
    b.close();
    rooms.dispose();
    wss.close();
  }
});

test("crouching replicates body height and moves the server weapon origin down", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss),
    a = await client((wss.address() as any).port);
  try {
    const ready = next(a, "welcome");
    a.send(JSON.stringify({ type: "create", name: "Croucher", seed: "paper" }));
    const welcome = await ready;
    const snapshot = next(a, "snapshot");
    a.send(
      JSON.stringify({
        type: "state",
        p: welcome.spawn,
        yaw: 0,
        pitch: 0,
        weapon: 0,
        height: 1.08,
      }),
    );
    const state = await snapshot;
    assert.equal(state.players[0].height, 1.08);
    const shot = next(a, "shot");
    a.send(JSON.stringify({ type: "fire" }));
    const data = await shot;
    assert.ok(Math.abs(data.from[1] - (welcome.spawn[1] + 0.92)) < 0.001);
  } finally {
    a.close();
    rooms.dispose();
    wss.close();
  }
});
