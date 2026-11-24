import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { PlayerAccounts, openPlayerStore } from "../server/player-accounts.ts";
import { PlayMetrics } from "../server/play-metrics.ts";
import { Rooms } from "../server/rooms.ts";

test("authenticated duel records sessions, totals and exactly one paired Elo change", async () => {
  process.env.PLAYER_DB = ":memory:";
  const store = await openPlayerStore(),
    accounts = new PlayerAccounts(store),
    metrics = new PlayMetrics(store);
  const server = http.createServer(
    (req, res) => void accounts.handle(req, res),
  );
  const sockets = new WebSocketServer({ noServer: true }),
    rooms = new Rooms(sockets, undefined, undefined, metrics);
  server.on("upgrade", async (req, socket, head) => {
    const user = await accounts.identity(req);
    sockets.handleUpgrade(req, socket, head, (ws) => {
      if (user) metrics.identities.set(ws, user);
      sockets.emit("connection", ws, req);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = "http://127.0.0.1:" + addr.port,
    clients: WebSocket[] = [];
  const post = (action: string, name: string, password: string, cookie = "") =>
    fetch(base + "/api/player/" + action, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: base },
      body: JSON.stringify({ name, password }),
    });
  async function join(cookie: string) {
    const ws = new WebSocket(base.replace("http", "ws"), {
      headers: { cookie },
    });
    clients.push(ws);
    await once(ws, "open");
    const welcome = new Promise<{ code: string; id: string }>(
      (resolve, reject) => {
        ws.on("message", (raw) => {
          const m = JSON.parse(String(raw));
          if (m.type === "welcome") resolve(m);
          if (m.type === "error") reject(Error(m.message));
        });
      },
    );
    ws.send(JSON.stringify({ type: "duel", name: "Alias" }));
    return welcome;
  }
  try {
    const pass = "example test password";
    const a = await post("register", "Alpha", pass),
      b = await post("register", "Bravo", pass);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.match(a.headers.get("set-cookie")!, /HttpOnly/);
    const cookieA = a.headers.get("set-cookie")!.split(";")[0],
      cookieB = b.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await post("register", "alpha", pass)).status, 409);
    assert.equal(
      (await post("login", "Alpha", "incorrect password")).status,
      401,
    );
    const hero = await join(cookieA),
      rival = await join(cookieB);
    assert.equal(hero.code, rival.code);
    const room = rooms.rooms.get(hero.code)!;
    const [winner, loser] = [...room.players.values()];
    assert.equal(winner.name, "Alpha");
    assert.equal(loser.name, "Bravo");
    for (let i = 0; i < 15; i++) {
      loser.hp = 100;
      loser.shieldUntil = 0;
      rooms.hurt(room, loser, winner, 100);
    }
    await metrics.flush();
    const profile = async (cookie: string) =>
      (
        await (
          await fetch(base + "/api/player/profile", { headers: { cookie } })
        ).json()
      ).profile;
    const first = await profile(cookieA),
      second = await profile(cookieB);
    assert.equal(first.rating, 1016);
    assert.equal(second.rating, 984);
    assert.equal(first.wins, 1);
    assert.equal(second.losses, 1);
    assert.equal(first.recent[0].delta, 16);
    assert.equal(first.lifetime.kills, 15);
    assert.equal(second.lifetime.deaths, 15);
    assert.equal(first.global.sessions, 2);
    assert.equal(first.global.kills, 15);
    const replay = { room: room.roomId, winner: hero.id, loser: rival.id };
    await store({ op: "metrics", batch: { sessions: [], results: [replay] } });
    assert.equal((await profile(cookieB)).rating, 984);
    assert.equal((await post("logout", "", "", cookieA)).status, 200);
    assert.equal(await profile(cookieA), null);
    const login = await post("login", "alpha", pass);
    assert.equal(login.status, 200);
    const restored = await profile(
      login.headers.get("set-cookie")!.split(";")[0],
    );
    assert.equal(restored.lifetime.sessions, 1);
    assert.equal(restored.rating, 1016);
  } finally {
    for (const ws of clients) ws.terminate();
    rooms.dispose();
    sockets.close();
    server.close();
    server.closeAllConnections();
  }
});
