import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { loadCountyFleet } from "../server/county-fleet.ts";
import { Rooms } from "../server/rooms.ts";
import { COUNTY, type CountyCar } from "../src/county.ts";
import {
  damageVehicle,
  nearestVehicleSurface,
  vehicleHandling,
} from "../src/county-vehicle-damage.ts";
import { generateLevel } from "../src/levels.ts";

test("the fleet mesh resolves a single tire, individual panes and bounded panel damage", async () => {
  const model = await loadCountyFleet("public");
  const car: CountyCar = { kind: "saloon", p: [0, 0, 0], yaw: 0, driver: null };
  const hit = (y: number, z: number, max = 10) =>
    nearestVehicleSurface([car], [-3, y, z], [1, 0, 0], max, model)?.hit;
  assert.equal(hit(0.32, -1.475, 2), undefined);
  const tire = hit(0.32, -1.475)!;
  assert.equal(tire.part, 1);
  assert.ok(damageVehicle(car, tire));
  assert.equal(damageVehicle(car, tire), false);
  assert.deepEqual(vehicleHandling(car), { pull: 0.34, speed: 0.85 });
  const pane = hit(1.04, -0.3)!;
  assert.equal(pane.part, 16);
  damageVehicle(car, pane);
  assert.notEqual(hit(1.04, -0.3)?.part, 16);
  assert.equal(hit(1.1, 0.75)?.part, 64);
  const panel = hit(0.69, 0)!;
  assert.equal(panel.dent?.panel, "door_mesh");
  for (let i = 0; i < 30; i++) damageVehicle(car, panel);
  assert.equal(car.dents?.length, 16);
  assert.equal(car.wear, 18);
  assert.equal(car.dentVersion, 30);
  assert.ok(vehicleHandling(car).speed < 0.85);
});

test("County broadcasts the struck part, restores damage to a joining player and resolves a close knife swing", async () => {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(wss, "listening");
  const rooms = new Rooms(wss, generateLevel);
  const clients: WebSocket[] = [];
  async function connect() {
    const ws = new WebSocket(
      "ws://127.0.0.1:" + (wss.address() as { port: number }).port,
    );
    clients.push(ws);
    const packets: any[] = [];
    ws.on("message", (raw) => packets.push(JSON.parse(String(raw))));
    await once(ws, "open");
    return {
      send: (m: object) => ws.send(JSON.stringify(m)),
      wait: async (type: string, predicate = (m: any) => true) => {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const packet = packets.find((m) => m.type === type && predicate(m));
          if (packet) return packet;
          await delay(10);
        }
        throw Error("Missing " + type);
      },
    };
  }
  try {
    rooms.vehicleModel = await loadCountyFleet("public");
    const a = await connect();
    a.send({ type: "duel", seed: COUNTY });
    const { code } = await a.wait("welcome");
    const room = rooms.rooms.get(code)!;
    const [attacker] = room.players.values();
    const car = room.cars![0];
    Object.assign(car, { p: [0, 50, 0], yaw: 0, kind: "saloon", driver: null });
    attacker.ready = true;
    attacker.p = [-3, 50 + 0.32 - attacker.height + 0.16, -1.475];
    attacker.yaw = -Math.PI / 2;
    attacker.pitch = 0;
    a.send({ type: "fire" });
    assert.equal((await a.wait("vehicle-impact")).part, 1);
    const b = await connect();
    b.send({ type: "join", code });
    await b.wait("welcome");
    assert.equal((await b.wait("snapshot", (m) => !!m.cars)).cars[0].damage, 1);
    const victim = [...room.players.values()][1];
    attacker.p = [10, 50, 10];
    attacker.yaw = 0;
    attacker.weapon = 4;
    victim.p = [10, 50, 8.98];
    victim.ready = true;
    victim.shieldUntil = 0;
    await delay(120);
    a.send({ type: "punch" });
    assert.equal((await a.wait("hit", (m) => m.melee)).kill, true);
    assert.equal(victim.hp, 0);
  } finally {
    clients.forEach((ws) => ws.close());
    rooms.dispose();
    wss.close();
  }
});
