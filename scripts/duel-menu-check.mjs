import { enterGuest } from "./guest-session.mjs";
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
const url = process.env.GAME_URL || "http://127.0.0.1:5199";
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 850 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await enterGuest(page);
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await page.waitForSelector("#duel:not(.hidden)");
  assert.equal(await page.locator("#play").innerText(), "Join public game");
  await page.screenshot({ path: "output/playwright/menu-play-duel.png" });
  peer = new WebSocket(new URL("/ws", url.replace(/^http/, "ws")));
  await new Promise((r) => peer.on("open", r));
  const welcome = new Promise((r) =>
    peer.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "welcome") r(m);
    }),
  );
  const mapScale = await page.evaluate(() =>
    import("/src/rust-boundary.ts").then((m) => m.RUST_SCALE),
  );
  peer.send(JSON.stringify({ type: "duel", name: "Duel partner", mapScale }));
  await welcome;
  await page.locator("#duel").click();
  assert.equal(await page.locator("#play").innerText(), "Join duel");
  await page.waitForFunction(() =>
    document.querySelector("#mode-detail").textContent.includes("1/8"),
  );
  peer.close();
  peer = null;
  await page.waitForFunction(
    () => !document.querySelector("#mode-detail").textContent.includes("1/8"),
  );
  await page.locator("#play").click();
  await page.locator("#equip-kit").click();
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
    "Verified public and duel selection, live occupancy, and joining a players-only duel.",
  );
} finally {
  peer?.close();
  await browser.close();
}
