import {
  BURST_AR,
  MAMMOTH,
  SMOKE,
  HEAVY_AR,
  FRAG,
  ROCKET,
  SMG,
  FLASH,
} from "../src/weapon-balance.ts";
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
test("both peers see the same explosive flight and the room applies splash once at impact", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.on("listening", resolve));
  const rooms = new Rooms(wss),
    port = (wss.address() as { port: number }).port;
  const a = await client(port),
    b = await client(port);
  try {
    const welcome = next(a, "welcome");
    a.send(
      JSON.stringify({
        type: "create",
        name: "Shark",
        seed: "paper",
        loadout: { primary: ROCKET, secondary: 2, utility: FRAG },
      }),
    );
    const { code } = await welcome,
      joined = next(b, "welcome");
    b.send(JSON.stringify({ type: "join", code, name: "Fin" }));
    await joined;
    const room = rooms.rooms.get(code)!;
    const [[socket, shooter], [, target]] = [...room.players];
    for (const weapon of [ROCKET, FRAG]) {
      shooter.p = [0, 65, 0];
      shooter.yaw = 0;
      shooter.pitch = 0;
      shooter.weapon = weapon;
      shooter.lastShot = 0;
      target.p = [0, 65, -8];
      target.hp = 100;
      target.shieldUntil = 0;
      const events = Promise.all([next(a, "grenade"), next(b, "grenade")]);
      rooms.handle(socket, { type: "fire" });
      const [one, two] = await events;
      assert.equal(one.effect.weapon, weapon);
      assert.deepEqual(one.effect, two.effect);
      assert.equal(shooter.mags[weapon], 0);
      assert.equal(target.hp, 100);
      const effect = room.effects.find((e) => e.weapon === weapon)!;
      // Move a second player into the splash without putting them on the shot line.
      target.p = [effect.p[0] + 2, effect.p[1] - 0.8, effect.p[2]];
      effect.flight!.impact = Date.now() - 1;
      rooms.tick();
      const after = target.hp;
      assert.ok(after > 0 && after < 100);
      rooms.tick();
      assert.equal(target.hp, after);
      rooms.handle(socket, { type: "reload" });
      assert.equal(shooter.reloadUntil > 0, weapon === ROCKET);
      shooter.reloadUntil = 0;
    }
  } finally {
    a.close();
    b.close();
    rooms.dispose();
    wss.close();
  }
});
test("real websocket clients join the same city and invalid rooms return a useful error", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss);
  const port = (wss.address() as any).port;
  const a = await client(port),
    b = await client(port);
  try {
    for (const name of [undefined, "  <>  "]) {
      const rejected = next(a, "error");
      a.send(JSON.stringify({ type: "create", name }));
      assert.match((await rejected).message, /nickname/i);
      assert.equal(rooms.rooms.size, 0);
    }
    const ready = next(a, "welcome");
    a.send(JSON.stringify({ type: "create", name: " Alice ", rating: 1600, seed: "paper" }));
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
    assert.equal(snapshot.players[0].name, "Alice");
    assert.equal(snapshot.players[0].rating, undefined);
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
    const wall = room.city.boxes.find(
      (b) => b.kind === "wall" && b.s[0] === 0.16 && b.s[1] > 3,
    )!;
    victim.hp = 100;
    victim.p = [wall.p[0] + 2, 0.1, wall.p[2]];
    shooter.p = [wall.p[0] - 2, 0.1, wall.p[2]];
    shooter.yaw = -Math.PI / 2;
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

test("multiplayer accepts outer-city movement and anchors, then enforces the generated boundary", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((r) => wss.on("listening", r));
  const rooms = new Rooms(wss),
    a = await client((wss.address() as any).port);
  try {
    const ready = next(a, "welcome");
    a.send(
      JSON.stringify({
        type: "create",
        name: "Outer runner",
        seed: "notebook",
      }),
    );
    const welcome = await ready;
    const room = rooms.rooms.get(welcome.code)!;
    const [socket, p] = [...room.players.entries()][0];
    p.p = [240, 0.16, 15];
    p.moveCredit = 5;
    p.lastMove = Date.now();
    rooms.handle(socket, {
      type: "state",
      p: [241, 0.16, 15],
      yaw: 0,
      pitch: 0,
      weapon: 0,
      height: 1.76,
      anchor: [260, 20, 15],
    });
    assert.equal(p.p[0], 241);
    assert.deepEqual(p.anchor, [260, 20, 15]);
    p.p = [room.city.bounds - 0.5, 0.16, 15];
    p.moveCredit = 5;
    rooms.handle(socket, {
      type: "state",
      p: [room.city.bounds + 1, 0.16, 15],
      yaw: 0,
      pitch: 0,
    });
    assert.equal(p.p[0], room.city.bounds - 0.5);
  } finally {
    a.close();
    rooms.dispose();
    wss.close();
  }
});

test("multiplayer permits spawn loadout changes and locks the kit after an attack", async () => {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.on("listening", resolve));
  const rooms = new Rooms(wss);
  const ws = await client((wss.address() as { port: number }).port);
  const first = { primary: BURST_AR, secondary: MAMMOTH, utility: SMOKE };
  const second = { primary: HEAVY_AR, secondary: SMG, utility: FLASH };
  try {
    const ready = next(ws, "welcome");
    ws.send(JSON.stringify({ type: "create", name: "Kit tester", seed: "paper", loadout: first }));
    const { code, loadout } = await ready;
    assert.deepEqual(loadout, first);
    const room = rooms.rooms.get(code)!;
    const [[socket, player]] = room.players;
    assert.deepEqual(player.owned, [BURST_AR, MAMMOTH, SMOKE]);
    assert.equal(player.weapon, BURST_AR);
    const equip = (weapon: number) =>
      rooms.handle(socket, {
        type: "state",
        p: player.p,
        yaw: 0,
        pitch: 0,
        height: 1.76,
        weapon,
      });
    rooms.handle(socket, {
      type: "equip-at-spawn",
      loadout: second,
      weapon: SMG,
    });
    assert.deepEqual(player.owned, [HEAVY_AR, SMG, FLASH]);
    assert.equal(player.weapon, SMG);
    rooms.handle(socket, {
      type: "equip-at-spawn",
      loadout: first,
      weapon: BURST_AR,
    });
    equip(SMG);
    assert.equal(player.weapon, BURST_AR);
    equip(SMOKE);
    const thrown = next(ws, "grenade");
    rooms.handle(socket, { type: "fire" });
    assert.equal((await thrown).effect.weapon, SMOKE);
    rooms.handle(socket, { type: "reload" });
    assert.equal(player.reloadUntil, 0);
    assert.equal(player.mags[SMOKE], 0);
    rooms.handle(socket, {
      type: "equip-at-spawn",
      loadout: second,
      weapon: SMG,
    });
    assert.deepEqual(player.loadout, first);
    assert.equal(player.mags[SMOKE], 0);
    rooms.handle(socket, { type: "respawn", loadout: second });
    assert.deepEqual(player.loadout, first);
    for (const kit of [undefined, second]) {
      player.hp = 0;
      player.deadAt = Date.now() - 3000;
      rooms.handle(socket, { type: "respawn", loadout: kit });
      const expected = kit ?? first;
      assert.deepEqual(player.loadout, expected);
      assert.equal(player.weapon, expected.primary);
      assert.equal(player.mags[expected.utility], 1);
      assert.deepEqual(player.owned, [
        expected.primary,
        expected.secondary,
        expected.utility,
      ]);
    }
  } finally {
    ws.close();
    rooms.dispose();
    wss.close();
  }
});
