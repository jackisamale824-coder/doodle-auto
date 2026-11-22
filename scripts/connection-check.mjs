import assert from "node:assert/strict";
import { WebSocket } from "ws";
const base = process.env.GAME_URL || "http://127.0.0.1:4174";
const url = base.replace(/^http/, "ws") + "/ws";
async function open() {
  const ws = new WebSocket(url, { origin: new URL(base).origin });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return ws;
}
const rejected = await new Promise((resolve, reject) => {
  const ws = new WebSocket(url, { origin: "https://unrelated.example" });
  ws.once("unexpected-response", (_, res) => {
    resolve(res.statusCode);
    res.resume();
    ws.terminate();
  });
  ws.on("error", () => {});
  ws.once("open", () => {
    ws.close();
    reject(Error("Cross-origin accepted"));
  });
});
assert.equal(rejected, 403);
for (const [kind, expected] of [
  ["oversize", 1009],
  ["spam", 1008],
]) {
  const ws = await open();
  const closed = new Promise((resolve) => ws.once("close", resolve));
  if (kind === "oversize") ws.send("x".repeat(4096));
  else
    for (let i = 0; i < 100; i++)
      ws.send(JSON.stringify({ type: "ping", time: i }));
  assert.equal(await closed, expected, kind);
}
const ws = await open(),
  samples = [];
for (let i = 0; i < 20; i++) {
  const start = performance.now();
  const pong = new Promise((resolve) => ws.once("pong", resolve));
  ws.ping();
  await pong;
  samples.push(performance.now() - start);
}
ws.close();
samples.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      url,
      crossOrigin: 403,
      oversize: 1009,
      spam: 1008,
      rttMedianMs: samples[10],
      rttP95Ms: samples[18],
    },
    null,
    2,
  ),
);
