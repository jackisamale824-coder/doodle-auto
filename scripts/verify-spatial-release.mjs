import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  leave,
  openPlayer,
  nextPacket,
  resumeMessage,
} from "./multiplayer-probe.mjs";

const origin = "https://gta.sully6.com";
const local = await readFile("dist/index.html", "utf8");
const asset = local.match(/src="([^"]*\/assets\/index-[^"]+\.js)"/)?.[1];
assert.ok(asset, "Expected a built game client in dist/index.html");
const response = await fetch(origin + "/?verify=" + Date.now(), {
  signal: AbortSignal.timeout(10000),
});
assert.ok(
  response.ok && (await response.text()).includes(asset),
  "Production is still serving a different client bundle",
);

const [lobbies, account] = await Promise.all(
  ["/lobbies", "/api/player/profile"].map(async (path) => {
    const response = await fetch(origin + path, {
      signal: AbortSignal.timeout(20000),
    });
    assert.equal(response.status, 200, path);
    return response.json();
  }),
);
assert.ok(Array.isArray(lobbies.lobbies));
assert.equal(account.profile, null, "Expected anonymous profile");
assert.equal(typeof account.googleEnabled, "boolean");

const clients = [];
try {
  for (const [path, seed, prefix] of [
    ["/ws", "rust", ""],
    ["/ws/county", "switchback-county", "G"],
    ["/ws/islands", "four-tides", "T"],
  ]) {
    const first = await openPlayer(origin, path, {
      type: "create",
      seed,
      name: "Release check",
    });
    clients.push(first.ws);
    assert.ok(first.welcome.code.startsWith(prefix) && first.welcome.sessionId);
    const peer = await openPlayer(origin, path, {
      type: "join",
      code: first.welcome.code,
      name: "Peer check",
    });
    clients.push(peer.ws);
    assert.equal(peer.welcome.roomId, first.welcome.roomId);
    await nextPacket(
      peer.ws,
      "snapshot",
      (p) =>
        Number.isInteger(p.revision) &&
        (seed !== "switchback-county" || Array.isArray(p.carUpdates)),
    );
    first.ws.terminate();
    const resumed = await openPlayer(
      origin,
      path,
      resumeMessage(first.welcome),
    );
    clients.push(resumed.ws);
    assert.equal(resumed.welcome.id, first.welcome.id);
    assert.equal(resumed.welcome.roomId, peer.welcome.roomId);
    assert.notEqual(resumed.welcome.resumeSecret, first.welcome.resumeSecret);
    await nextPacket(resumed.ws, "snapshot");
    leave(peer.ws);
    leave(resumed.ws);
  }
  console.log(
    "Verified",
    asset,
    "lobbies, guest profile, two-player rooms, snapshots and session recovery on all three map servers.",
  );
} finally {
  for (const ws of clients) leave(ws);
}
