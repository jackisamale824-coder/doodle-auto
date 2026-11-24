import { randomBytes } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  rack,
  step,
  strike,
  settle,
  DT,
  other,
  type Seat,
  type Motion,
  type Match,
} from "../src/pool/game.ts";

interface Table {
  code: string;
  seats: WebSocket[];
  public: boolean;
  game: Match;
  shot: Motion | null;
  remaining: number;
  last: number;
  activity: number;
  ready: Set<WebSocket>;
  breaker: Seat;
}
export function createPoolServer() {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024,
    perMessageDeflate: false,
  });
  const tables = new Map<string, Table>();
  const membership = new Map<WebSocket, Table>();
  const send = (ws: WebSocket, msg: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  function broadcast(t: Table, msg: unknown) {
    for (const ws of t.seats) send(ws, msg);
  }
  function release(t: Table) {
    tables.delete(t.code);
    for (const peer of t.seats) membership.delete(peer);
  }
  function leave(ws: WebSocket) {
    const t = membership.get(ws);
    if (!t) return;
    release(t);
    for (const peer of t.seats)
      if (peer !== ws) {
        send(peer, { type: "departed", game: t.game, shot: t.shot });
        peer.close(1000, "Opponent left");
      }
  }
  const alive = new Set<WebSocket>();
  wss.on("connection", (ws) => {
    let windowStart = Date.now(),
      inputs = 0;
    const deadline = setTimeout(() => {
      if (!membership.has(ws)) ws.close(1000, "Table selection timed out");
    }, 15000);
    ws.on("pong", () => alive.add(ws));
    alive.add(ws);
    ws.on("error", () => ws.terminate());
    ws.on("close", () => {
      clearTimeout(deadline);
      alive.delete(ws);
      leave(ws);
    });
    ws.on("message", (raw) => {
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        inputs = 0;
      }
      if (++inputs > 25) {
        ws.close(1008, "Too many inputs");
        return;
      }
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;
      let t = membership.get(ws);
      const fail = (message: string) => send(ws, { type: "error", message });
      if (!t) {
        if (msg.type !== "enter") return;
        if (msg.mode === "join") {
          t =
            typeof msg.code === "string"
              ? tables.get(msg.code.toUpperCase())
              : undefined;
          if (!t || t.seats.length !== 1) {
            fail("That table is full or has closed.");
            return;
          }
        } else if (msg.mode === "create" || msg.mode === "find") {
          if (msg.mode === "find")
            t = [...tables.values()].find(
              (t) => t.public && t.seats.length === 1,
            );
          if (!t) {
            let code: string;
            do {
              code = randomBytes(3).toString("hex").toUpperCase();
            } while (tables.has(code));
            t = {
              code,
              seats: [],
              public: msg.mode === "find",
              game: rack(),
              shot: null,
              remaining: 0,
              last: 0,
              activity: now,
              ready: new Set(),
              breaker: 0,
            };
            tables.set(code, t);
          }
        } else return;
        clearTimeout(deadline);
        membership.set(ws, t);
        t.activity = now;
        const seat = t.seats.length;
        t.seats.push(ws);
        send(ws, { type: "seat", seat, code: t.code });
        if (t.seats.length === 2) broadcast(t, { type: "start", game: t.game });
        return;
      }
      if (t.seats.length !== 2) return;
      if (msg.type === "rematch" && t.game.winner !== null) {
        t.ready.add(ws);
        t.activity = now;
        if (t.ready.size === 2) {
          t.breaker = other(t.breaker);
          t.game = rack(t.breaker);
          t.ready.clear();
          broadcast(t, { type: "start", game: t.game });
        } else broadcast(t, { type: "rematch", seat: t.seats.indexOf(ws) });
      }
      if (msg.type !== "shoot") return;
      if (t.seats[t.game.turn] !== ws || t.shot || t.game.winner !== null) {
        fail("Wait for your turn.");
        return;
      }
      const { angle, power, x, y } = msg;
      const shot = strike(t.game, { angle, power, x, y });
      if (!shot) {
        fail("Choose a clear cue-ball position and try again.");
        return;
      }
      t.shot = shot;
      t.last = performance.now();
      t.remaining = 0;
      t.activity = now;
      broadcast(t, { type: "rolling", game: t.game, shot });
    });
  });
  const tick = setInterval(() => {
    const now = performance.now();
    for (const t of tables.values()) {
      if (!t.shot) continue;
      t.remaining += Math.min(0.25, (now - t.last) / 1000);
      t.last = now;
      while (t.remaining >= DT) {
        t.remaining -= DT;
        if (step(t.game, t.shot)) continue;
        settle(t.game, t.shot);
        t.shot = null;
        broadcast(t, { type: "settled", game: t.game });
        break;
      }
    }
  }, 20);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.delete(ws)) {
        ws.terminate();
        continue;
      }
      ws.ping();
      const t = membership.get(ws);
      if (t && Date.now() - t.activity > 20 * 60_000)
        ws.close(1000, "Inactive table");
    }
  }, 30000);
  wss.on("close", () => {
    clearInterval(tick);
    clearInterval(heartbeat);
  });
  return wss;
}
