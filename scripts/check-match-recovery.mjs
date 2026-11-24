import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  leave,
  nextPacket,
  openPlayer,
  resumeMessage,
} from "./multiplayer-probe.mjs";

const dir = await mkdtemp(join(tmpdir(), "doodle-recovery-"));
let child, origin;
const clients = [];
async function start() {
  child = spawn(process.execPath, ["output/game-server.mjs"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "0",
      HOST: "127.0.0.1",
      ROOM_CODE_PREFIX: "G",
      PLAYER_STORE_URL: "",
      PLAYER_DB: join(dir, "players.sqlite"),
      MATCH_RECOVERY: "1",
      RELEASE_ID: "",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let output = "";
  for await (const chunk of child.stdout) {
    output += chunk;
    const match = output.match(/http:\/\/127[.]0[.]0[.]1:\d+/);
    if (match) {
      origin = match[0];
      return;
    }
  }
  throw Error("Server stopped during startup");
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
}
async function connect(message) {
  const client = await openPlayer(origin, "/ws/county", message);
  clients.push(client);
  return client;
}
function percentile(series, p) {
  return series.sort((a, b) => a - b)[Math.ceil(series.length * p) - 1];
}
try {
  await start();
  const group = await Promise.all(
    Array.from({ length: 31 }, (_, i) =>
      connect({
        type: "public",
        name: "Driver " + i,
        seed: "switchback-county",
      }),
    ),
  );
  const counts = new Map();
  for (const { welcome } of group)
    counts.set(welcome.code, (counts.get(welcome.code) ?? 0) + 1);
  assert.deepEqual(
    [...counts.values()].sort((a, b) => a - b),
    [1, 30],
  );
  const rtts = [],
    frames = group.map(() => 0);
  group.forEach(({ ws }, i) =>
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "snapshot") frames[i]++;
      if (m.type === "pong") rtts.push(performance.now() - m.time);
    }),
  );
  const started = performance.now();
  let step = 0;
  const duration = Number(process.env.MATCH_LOAD_SECONDS ?? 10) * 1000;
  assert.ok(duration >= 10000 && Number.isFinite(duration));
  while (performance.now() - started < duration) {
    for (const { ws, welcome } of group) {
      ws.send(
        JSON.stringify({
          type: "state",
          p: welcome.spawn,
          yaw: 0.43,
          pitch: 0,
        }),
      );
      if (step % 10 === 0)
        ws.send(JSON.stringify({ type: "ping", time: performance.now() }));
    }
    step++;
    await delay(50);
  }
  const seconds = (performance.now() - started) / 1000;
  assert.ok(rtts.length >= group.length * 10);
  assert.ok(Math.min(...frames) / seconds > 20, "a client stalled");
  console.log(
    JSON.stringify({
      clients: group.length,
      seconds: +seconds.toFixed(2),
      inputsPerSecond: Math.round((step * group.length) / seconds),
      minimumSnapshotHz: +(Math.min(...frames) / seconds).toFixed(1),
      p95PingMs: +percentile(rtts, 0.95).toFixed(2),
      p99PingMs: +percentile(rtts, 0.99).toFixed(2),
    }),
  );
  await stop(); // No shutdown handler or final save runs.
  await start();
  const recovered = await Promise.all(
    group.map((c) => connect(resumeMessage(c.welcome))),
  );
  for (let i = 0; i < group.length; i++) {
    assert.equal(recovered[i].welcome.roomId, group[i].welcome.roomId);
    assert.equal(recovered[i].welcome.id, group[i].welcome.id);
    assert.equal(recovered[i].welcome.yaw, 0.43);
    assert.notEqual(
      recovered[i].welcome.resumeSecret,
      group[i].welcome.resumeSecret,
    );
  }
  await Promise.all(recovered.map((c) => nextPacket(c.ws, "snapshot")));
  console.log(
    "All 31 players recovered their rooms, identity and checkpointed input after process loss.",
  );
  for (const { ws } of recovered) leave(ws);
} finally {
  for (const { ws } of clients) ws.terminate();
  await stop();
  await rm(dir, { recursive: true, force: true });
}
