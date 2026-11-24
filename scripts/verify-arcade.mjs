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
  ["https://gta.sully6.com/", "Doodle Auto"],
  ["https://drive-mad.sully6.com/", "Drive Mad"],
  ["https://pool.sully6.com/", "Side Pocket"],
  ["https://vice-city.sully6.com/", "Vice Coast"],
]);
assert.deepEqual(new Set(hosts), new Set(titles.keys()));
await Promise.all(hosts.map(async host => {
  assert.ok(live.includes(`href="${host}"`), `Missing tile for ${host}`);
  if (host === "https://vice-city.sully6.com/") {
    const response = await fetch(host + now, { redirect: "manual", signal: AbortSignal.timeout(12000) });
    assert.equal(response.status, 200, host);
    const page = await response.text();
    assert.ok(page.includes("<title>Vice Coast</title>") && page.includes('<canvas id="view"'), host);
    assert.doesNotMatch(page, /<iframe\b|quenq\.com/i);
    return;
  }
  const page = await html(host + now);
  assert.ok(page.includes("<title>" + titles.get(host)), `Wrong game at ${host}`);
  if (host === "https://drive-mad.sully6.com/") {
    assert.match(page, /<iframe\b[^>]*\bsrc="https:\/\/drive-mad-game-theta\.vercel\.app\/"/);
  }
}));
console.log("Verified the arcade and", hosts.length, "public game hosts.");
