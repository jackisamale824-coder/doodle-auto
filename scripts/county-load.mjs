import assert from "node:assert/strict";
import { WebSocket } from "ws";
const clients = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const endpoint = process.env.COUNTY_TEST_WS ?? "ws://127.0.0.1:5197/ws";
try {
  for (let i = 0; i < 31; i++) {
    const ws = new WebSocket(endpoint),
      client = { ws, snapshots: 0, maxDrivers: 0 };
    clients.push(client);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Join timed out")), 5000);
      ws.once("error", reject);
      ws.on("open", () =>
        ws.send(
          JSON.stringify({
            type: "public",
            seed: "switchback-county",
            name: "Driver " + i,
          }),
        ),
      );
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "welcome") {
          clearTimeout(timer);
          client.code = m.code;
          client.spawn = m.spawn;
          resolve();
        }
        if (m.type === "snapshot") {
          client.snapshots++;
          client.maxDrivers = Math.max(client.maxDrivers, m.players.length);
        }
        if (m.type === "correction") client.corrected = true;
      });
    });
    await delay(140);
  }
  for (let n = 0; n < 40; n++) {
    for (const c of clients) {
      const [x, y, z] = c.spawn;
      c.ws.send(
        JSON.stringify({
          type: "state",
          p: [x, y, z - n * 0.2],
          yaw: 0,
          pitch: 0,
        }),
      );
    }
    await delay(50);
  }
  for (const c of clients.slice(0, 30)) {
    assert.equal(c.code, clients[0].code);
    assert.equal(c.maxDrivers, 30);
    assert.ok(c.snapshots >= 30);
    assert.ok(!c.corrected);
  }
  assert.notEqual(clients[30].code, clients[0].code);
  console.log(
    "30 moving clients shared one room and received snapshots; client 31 joined another.",
  );
} finally {
  for (const { ws } of clients) ws.close();
}
