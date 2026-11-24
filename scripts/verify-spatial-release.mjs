import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WebSocket } from "ws";

const origin = "https://sully6.com";
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

const ws = new WebSocket("wss://sully6.com/ws", { origin });
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Timed out waiting for a match snapshot")),
      15000,
    );
    ws.once("close", () => {
      clearTimeout(timeout);
      reject(Error("Connection closed"));
    });
    ws.once("error", reject);
    ws.once("open", () =>
      ws.send(
        JSON.stringify({
          type: "create",
          seed: "switchback-county",
          name: "Release check",
          compact: true,
          spatialSnapshots: 1,
        }),
      ),
    );
    ws.on("message", (raw) => {
      const packet = JSON.parse(raw);
      if (packet.type === "error") reject(Error(packet.message));
      if (
        packet.type === "snapshot" &&
        Number.isInteger(packet.revision) &&
        Array.isArray(packet.carUpdates)
      ) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  console.log(
    "Verified production bundle",
    asset,
    "and spatial multiplayer snapshots.",
  );
} finally {
  if (ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: "leave" }));
  ws.close();
}
