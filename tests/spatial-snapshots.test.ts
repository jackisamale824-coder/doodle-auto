import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";
import { Network } from "../src/network.ts";
import { Rooms } from "../server/rooms.ts";

test("spatial snapshots preserve distant actors between updates and reduce bytes on the wire", async () => {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  const addr = "127.0.0.1:" + (wss.address() as { port: number }).port;
  const rooms = new Rooms(wss);
  clearInterval(rooms["timer"]); // Step a fixed number of ticks for both clients.
  const network = new Network();
  const legacy = new WebSocket("ws://" + addr + "/ws");
  Object.assign(globalThis, { location: new URL("http://" + addr), WebSocket });
  try {
    await once(legacy, "open");
    const welcome = await network.connect("create", "near", "fixture", "");
    const room = rooms.rooms.get(welcome.code)!;
    const joined = once(legacy, "message");
    legacy.send(
      JSON.stringify({ type: "join", name: "Far", compact: true, code: room.code }),
    );
    await joined;
    const viewer = [...room.players.values()][0];
    viewer.p = [0, 0, 0];
    const npc = (x: number, i: number) => ({
      ...viewer,
      id: "npc-" + i,
      npc: true,
      p: [x, 0, 0],
    });
    room.npcs = Array.from({ length: 24 }, (_, i) =>
      npc(i ? 500 : 5, i),
    ) as typeof room.npcs;
    room.cars = [5, 500].map((x) => ({
      p: [x, 0, 0],
      yaw: 0,
      kind: "saloon",
      driver: null,
    })) as typeof room.cars;
    rooms.roster(room);
    const frames: any[] = [],
      legacyFrames: any[] = [];
    let spatialBytes = 0,
      legacyBytes = 0;
    function collect(raw: unknown, spatial: boolean) {
      const m = JSON.parse(String(raw));
      if (m.type !== "snapshot") return;
      (spatial ? frames : legacyFrames).push(m);
      if (spatial) spatialBytes += Buffer.byteLength(String(raw));
      else legacyBytes += Buffer.byteLength(String(raw));
    }
    (network.socket as unknown as WebSocket).on("message", (raw) =>
      collect(raw, true),
    );
    legacy.on("message", (raw) => collect(raw, false));
    let expected = 0;
    async function step() {
      rooms.tick();
      expected++;
      const until = Date.now() + 3000;
      while (frames.length < expected || legacyFrames.length < expected) {
        assert.ok(Date.now() < until, "missing snapshot");
        await delay(2);
      }
    }
    await step();
    assert.equal(frames[0].actors.length, 26);
    assert.equal(frames[0].cars.length, 2);
    room.npcs[0].p[0] = 7;
    room.npcs[1].p[0] = 510;
    await step();
    assert.deepEqual(frames[1].indices, [0, 1, 2]);
    assert.equal(network.players.length, 26);
    assert.equal(network.players[2].p[0], 7);
    assert.equal(network.players[3].p[0], 500);
    while (expected < 31) await step();
    assert.equal(network.players[3].p[0], 510);
    assert.deepEqual(
      frames[3].carUpdates.map(([i]: [number]) => i),
      [0],
    );
    assert.equal(frames[30].cars.length, 2);
    assert.ok(legacyFrames.every((m) => m.actors.length === 26 && !m.indices));
    assert.ok(spatialBytes < legacyBytes * 0.6);
    console.log("snapshot bytes over 31 ticks", { legacyBytes, spatialBytes });
    room.npcs.reverse();
    rooms.roster(room);
    await step();
    assert.equal(frames.at(-1).indices, undefined);
    assert.equal(network.players[2].id, "npc-23");
  } finally {
    network.disconnect();
    legacy.close();
    rooms.dispose();
    wss.close();
  }
});
