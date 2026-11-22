import { chromium } from "playwright";
import { WebSocket } from "ws";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
let peer;
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 850 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5199");
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await page.waitForSelector("#duel:not(.hidden)");
  assert.match(await page.locator("#play").innerText(), /^PLAY/);
  await page.screenshot({ path: "output/playwright/menu-play-duel.png" });
  peer = new WebSocket("ws://127.0.0.1:5199/ws");
  await new Promise((r) => peer.on("open", r));
  const welcome = new Promise((r) =>
    peer.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "welcome") r(m);
    }),
  );
  peer.send(JSON.stringify({ type: "duel", name: "Duel partner" }));
  const room = await welcome;
  await page.waitForFunction(() =>
    document.querySelector("#play").textContent.includes("JOIN LOBBY"),
  );
  assert.equal(await page.locator("#duel").isVisible(), false);
  assert.match(await page.locator("#play").innerText(), /duel.*1\/8/);
  await page.screenshot({ path: "output/playwright/menu-join-duel.png" });
  peer.close();
  peer = null;
  await page.waitForSelector("#duel:not(.hidden)");
  assert.match(await page.locator("#play").innerText(), /^PLAY/);
  await page.locator("#duel").click();
  await page.waitForFunction(
    () => window.__doodles.network.duel && window.__doodles.mode === "online",
  );
  await page.waitForSelector("#hud:not(.hidden)", { timeout: 60000 });
  assert.equal(
    await page.evaluate(() =>
      window.__doodles.network.players.some((p) => p.npc),
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Menu verified: empty Play/Duel, occupied Join Duel (1/8), disconnect restores choices, Duel click enters without NPCs.",
  );
} finally {
  peer?.close();
  await browser.close();
}
