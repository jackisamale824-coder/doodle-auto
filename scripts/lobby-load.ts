import { WebSocket, WebSocketServer } from "ws";
import { Rooms } from "../server/rooms.ts";
import { writeFile } from "node:fs/promises";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const wss = new WebSocketServer({ port: 0, perMessageDeflate: false });
await new Promise((r) => wss.once("listening", r));
const rooms = new Rooms(wss),
  clients: WebSocket[] = [],
  samples: number[] = [];
let bytes = 0,
  snapshots = 0;
const tick = rooms.tick.bind(rooms);
rooms.tick = () => {
  const t = performance.now();
  tick();
  samples.push(performance.now() - t);
};
try {
  for (let i = 0; i < 16; i++) {
    const ws = new WebSocket(`ws://localhost:${(wss.address() as any).port}`);
    clients.push(ws);
    await new Promise((r) => ws.once("open", r));
    ws.on("message", (raw) => {
      bytes += raw.length;
      const m = JSON.parse(String(raw));
      if (m.type === "welcome")
        ws.send(
          JSON.stringify({
            type: "state",
            p: m.spawn,
            yaw: 0,
            pitch: 0,
            weapon: 0,
          }),
        );
      if (m.type === "snapshot") snapshots++;
    });
    ws.send(
      JSON.stringify({ type: "public", name: "Load " + i, compact: true }),
    );
  }
  await wait(1000);
  bytes = 0;
  snapshots = 0;
  samples.length = 0;
  const t = performance.now();
  await wait(5000);
  const seconds = (performance.now() - t) / 1000;
  samples.sort((a, b) => a - b);
  const result = {
    players: 16,
    npcs: [...rooms.rooms.values()][0].npcs.length,
    rooms: rooms.rooms.size,
    tickP95Ms: samples[Math.floor(samples.length * 0.95)],
    tickMaxMs: samples.at(-1),
    snapshotHzPerClient: snapshots / 16 / seconds,
    kilobytesPerSecondPerClient: bytes / 16 / seconds / 1024,
  };
  await writeFile(
    "output/playwright/lobby-load.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} finally {
  clients.forEach((ws) => ws.close());
  rooms.dispose();
  wss.close();
}
