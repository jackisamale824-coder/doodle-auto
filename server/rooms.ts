import { randomBytes, randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { generateCity, worldRay, type City, type V3 } from "../src/world.ts";
export interface PlayerState {
  id: string;
  name: string;
  p: V3;
  yaw: number;
  pitch: number;
  hp: number;
  kills: number;
  deaths: number;
  weapon: number;
  height: number;
  anchor: V3 | null;
  lastMove: number;
  lastShot: number;
  deadAt: number;
  shieldUntil: number;
}
interface Room {
  code: string;
  seed: string;
  city: City;
  players: Map<WebSocket, PlayerState>;
  created: number;
}
const validVector = (p: unknown): p is V3 =>
  Array.isArray(p) &&
  p.length === 3 &&
  p.every(
    (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 200,
  );
const send = (ws: WebSocket, m: unknown) => {
  if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 200000)
    ws.send(JSON.stringify(m));
};
export class Rooms {
  rooms = new Map<string, Room>();
  memberships = new Map<WebSocket, Room>();
  private timer: NodeJS.Timeout;
  constructor(wss: WebSocketServer) {
    wss.on("connection", (ws) => {
      let messages = 0,
        epoch = Date.now();
      ws.on("message", (raw) => {
        if (Date.now() - epoch > 1000) {
          epoch = Date.now();
          messages = 0;
        }
        if (++messages > 90) {
          ws.close(1008, "Too many messages");
          return;
        }
        try {
          this.handle(ws, JSON.parse(raw.toString()));
        } catch {
          send(ws, { type: "error", message: "Invalid game message." });
        }
      });
      ws.on("error", () => this.leave(ws));
      ws.on("close", () => this.leave(ws));
    });
    this.timer = setInterval(() => {
      for (const r of this.rooms.values())
        this.broadcast(r, {
          type: "snapshot",
          time: Date.now(),
          players: [...r.players.values()].map((p) => ({
            id: p.id,
            name: p.name,
            p: p.p,
            yaw: p.yaw,
            pitch: p.pitch,
            hp: p.hp,
            kills: p.kills,
            deaths: p.deaths,
            weapon: p.weapon,
            height: p.height,
            anchor: p.anchor,
          })),
        });
    }, 50);
  }
  broadcast(r: Room, m: unknown) {
    for (const ws of r.players.keys()) send(ws, m);
  }
  leave(ws: WebSocket) {
    const r = this.memberships.get(ws);
    if (!r) return;
    r.players.delete(ws);
    this.memberships.delete(ws);
    if (!r.players.size) this.rooms.delete(r.code);
  }
  handle(ws: WebSocket, m: any) {
    if (!m || typeof m.type !== "string") return;
    if (m.type === "create" || m.type === "join") {
      let r: Room | undefined;
      if (m.type === "create") {
        if (this.rooms.size >= 64) {
          send(ws, {
            type: "error",
            message: "All rooms are busy. Please try again.",
          });
          return;
        }
        let code = "";
        do {
          code = randomBytes(4).toString("hex").slice(0, 5).toUpperCase();
        } while (this.rooms.has(code));
        const seed = String(m.seed || "paper").slice(0, 40);
        r = {
          code,
          seed,
          city: generateCity(seed),
          players: new Map(),
          created: Date.now(),
        };
        this.rooms.set(code, r);
      } else r = this.rooms.get(String(m.code).trim().toUpperCase());
      if (!r) {
        send(ws, {
          type: "error",
          message: "That room does not exist. Check the five-character code.",
        });
        return;
      }
      if (r.players.size >= 8) {
        send(ws, { type: "error", message: "That room is full (8 players)." });
        return;
      }
      this.leave(ws);
      const p: PlayerState = {
        id: randomUUID(),
        name: String(m.name || "Runner")
          .replace(/[<>\u0000-\u001f]/g, "")
          .slice(0, 16),
        p: [...r.city.spawns[r.players.size]],
        yaw: 0,
        pitch: 0,
        hp: 100,
        kills: 0,
        deaths: 0,
        weapon: 0,
        height: 1.76,
        anchor: null,
        lastMove: Date.now(),
        lastShot: 0,
        deadAt: 0,
        shieldUntil: Date.now() + 3000,
      };
      r.players.set(ws, p);
      this.memberships.set(ws, r);
      send(ws, {
        type: "welcome",
        id: p.id,
        code: r.code,
        seed: r.seed,
        spawn: p.p,
      });
      return;
    }
    const r = this.memberships.get(ws),
      p = r?.players.get(ws);
    if (!r || !p) return;
    if (m.type === "leave") {
      this.leave(ws);
      return;
    }
    if (m.type === "state" && p.hp > 0) {
      if (
        !validVector(m.p) ||
        !Number.isFinite(m.yaw) ||
        !Number.isFinite(m.pitch)
      )
        return;
      const now = Date.now(),
        dt = Math.min(0.5, (now - p.lastMove) / 1000);
      const displacement = Math.hypot(
        ...m.p.map((v: number, i: number) => v - p.p[i]),
      );
      if (
        displacement > dt * 55 + 3 ||
        m.p[1] < -5 ||
        m.p[1] > 100 ||
        Math.abs(m.p[0]) > 92 ||
        Math.abs(m.p[2]) > 92
      ) {
        send(ws, { type: "correction", p: p.p });
        return;
      }
      p.p = m.p;
      p.yaw = m.yaw;
      p.pitch = Math.max(-1.5, Math.min(1.5, m.pitch));
      p.weapon = [0, 1, 2].includes(m.weapon) ? m.weapon : 0;
      p.height = Number.isFinite(m.height)
        ? Math.max(1.08, Math.min(1.76, m.height))
        : 1.76;
      p.anchor = validVector(m.anchor) ? m.anchor : null;
      p.lastMove = now;
      return;
    }
    if (m.type === "respawn" && p.hp <= 0 && Date.now() - p.deadAt > 2200) {
      p.p = [...r.city.spawns[Math.floor(Math.random() * 8)]];
      p.hp = 100;
      p.shieldUntil = Date.now() + 2500;
      p.lastMove = Date.now();
      send(ws, { type: "respawn", p: p.p });
      return;
    }
    if (m.type === "fire" && p.hp > 0) {
      const now = Date.now(),
        rates = [110, 700, 240],
        damages = [24, 14, 35];
      if (now - p.lastShot < rates[p.weapon]) return;
      p.lastShot = now;
      const dir: V3 = [
          -Math.sin(p.yaw) * Math.cos(p.pitch),
          Math.sin(p.pitch),
          -Math.cos(p.yaw) * Math.cos(p.pitch),
        ],
        origin: V3 = [p.p[0], p.p[1] + p.height - 0.16, p.p[2]];
      const rays = p.weapon === 1 ? 7 : 1;
      let endpoint: V3 = origin.map((v, i) => v + dir[i] * 70) as V3;
      for (let pellet = 0; pellet < rays; pellet++) {
        const d: V3 = [...dir];
        if (rays > 1) {
          d[0] += (Math.random() - 0.5) * 0.13;
          d[1] += (Math.random() - 0.5) * 0.13;
          d[2] += (Math.random() - 0.5) * 0.13;
          const len = Math.hypot(...d);
          for (let k = 0; k < 3; k++) d[k] /= len;
        }
        let nearest = worldRay(r.city.boxes, origin, d, 90)?.distance ?? 90,
          victim: PlayerState | undefined,
          head = false;
        for (const other of r.players.values()) {
          if (other === p || other.hp <= 0 || now < other.shieldUntil) continue;
          for (const [height, radius] of [
            [other.height - 0.21, 0.27],
            [other.height * 0.5, 0.48],
          ]) {
            const offset = other.p.map(
              (v, i) => v + (i === 1 ? height : 0) - origin[i],
            );
            const t = offset.reduce((s, v, i) => s + v * d[i], 0),
              perp = offset.reduce((s, v) => s + v * v, 0) - t * t;
            if (t > 0.1 && t < nearest && perp < radius * radius) {
              nearest = t;
              victim = other;
              head = height > other.height * 0.7;
            }
          }
        }
        endpoint = origin.map((v, i) => v + d[i] * nearest) as V3;
        if (victim) {
          const damage = Math.round(damages[p.weapon] * (head ? 1.6 : 1));
          victim.hp = Math.max(0, victim.hp - damage);
          send(ws, { type: "hit", head, kill: victim.hp === 0 });
          if (victim.hp === 0) {
            victim.deadAt = now;
            victim.deaths++;
            p.kills++;
            this.broadcast(r, {
              type: "kill",
              by: p.name,
              victim: victim.name,
            });
          }
        }
      }
      this.broadcast(r, { type: "shot", id: p.id, from: origin, to: endpoint });
    }
  }
  dispose() {
    clearInterval(this.timer);
    this.rooms.clear();
    this.memberships.clear();
  }
}
