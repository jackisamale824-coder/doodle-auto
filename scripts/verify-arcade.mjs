import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const directory = await readFile(new URL("../public/arcade/index.html", import.meta.url), "utf8");
async function html(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  assert.equal(response.status, 200, url);
  return response.text();
}
const hosts = [...directory.matchAll(/href="(https:\/\/[^"]+\.sully6\.com\/)"/g)].map(match => match[1]);
const now = "?verify=" + Date.now();
const live = await html("https://sully6.com/" + now);
assert.ok(live.includes("<title>Sully6 Arcade</title>"), "Expected the arcade on the apex");
const titles = new Map([
  ["https://doodle-auto.sully6.com/", "Doodle Auto"],
  ["https://drive-mad.sully6.com/", "Drive Mad"],
  ["https://pool.sully6.com/", "Side Pocket"],
  ["https://revenge.sully6.com/", "Revenge"],
]);
assert.deepEqual(new Set(hosts), new Set(titles.keys()));
for (const [from, to] of [
  ["https://gta.sully6.com/index.html?mode=rust&room=ABC", "https://doodle-auto.sully6.com/index.html?mode=rust&room=ABC"],
  ["https://sully6.com/?level=islands", "https://doodle-auto.sully6.com/?level=islands"],
]) {
  const response = await fetch(from, { redirect: "manual", signal: AbortSignal.timeout(12000) });
  assert.ok([302, 308].includes(response.status), from);
  assert.equal(response.headers.get("location"), to);
}
await Promise.all(hosts.map(async host => {
  assert.ok(live.includes(`href="${host}"`), `Missing tile for ${host}`);
  const page = await html(host + now);
  assert.ok(page.includes("<title>" + titles.get(host)), `Wrong game at ${host}`);
  if (host === "https://revenge.sully6.com/") {
    assert.match(page, /<canvas id="scene"/);
    const script = await fetch(new URL("game.js", host), { redirect: "error", signal: AbortSignal.timeout(12000) });
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /javascript/);
  }
  if (host === "https://drive-mad.sully6.com/") {
    assert.match(page, /<iframe\b[^>]*\bsrc="https:\/\/drive-mad-game-theta\.vercel\.app\/"/);
  }
}));
console.log("Verified the arcade and", hosts.length, "public game hosts.");
