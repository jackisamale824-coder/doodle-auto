import assert from "node:assert/strict";
import { chromium } from "playwright";
import { botStroke } from "../src/pool/aim.ts";

const url = process.env.POOL_URL || "http://localhost:4173/pool/";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || undefined,
});
try {
  const host = await browser.newPage({
      viewport: { width: 1250, height: 860 },
    }),
    guest = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pages = [host, guest],
    errors = [];
  let state,
    starts = 0;
  for (const page of pages)
    page.on("pageerror", (err) => errors.push(String(err)));
  host.on("websocket", (ws) =>
    ws.on("framereceived", ({ payload }) => {
      const msg = JSON.parse(String(payload));
      if (msg.type === "start") {
        starts++;
        state = msg.game;
      }
      if (msg.type === "settled") state = msg.game;
    }),
  );
  await host.goto(url);
  await host.getByRole("heading", { name: "Side Pocket" }).waitFor();
  await host.locator("#guide").click();
  assert.equal(
    await host.locator("#guide").getAttribute("aria-pressed"),
    "false",
  );
  await host.locator("#guide").click();
  await host.locator("#rules").click();
  await host.locator("#help .close").click();
  if (process.env.POOL_SCREENSHOT)
    await host.screenshot({ path: process.env.POOL_SCREENSHOT });
  await host.locator("#online").click();
  await host.locator("#create").click();
  await host.waitForFunction(
    () => document.querySelector("#roomcode").textContent.length === 6,
  );
  const code = await host.locator("#roomcode").textContent();
  const invite = new URL(url);
  invite.searchParams.set("table", code);
  await guest.goto(invite.href);
  await guest.locator("#lobby").waitFor({ state: "hidden" });
  await host.waitForFunction(() =>
    document.querySelector("#mode").textContent.startsWith("Online"),
  );
  const third = await browser.newPage();
  await third.goto(invite.href);
  await third.getByText("That table is full or has closed.").waitFor();
  await third.close();
  while (state.winner === null) {
    assert.ok(state.shots < 120, "Rack never finished");
    const page = pages[state.turn],
      { angle, power, x, y } = botStroke(state);
    const canvas = page.locator("#table"),
      bounds = await canvas.boundingBox();
    const upright = bounds.height > bounds.width;
    const scale = Math.min(
      bounds.width / (upright ? 542 : 992),
      bounds.height / (upright ? 992 : 542),
    );
    const at = (x, y) => ({
      x: bounds.width / 2 + (upright ? y - 225 : x - 450) * scale,
      y: bounds.height / 2 + (upright ? 450 - x : y - 225) * scale,
    });
    const cue = state.balls[0],
      cx = x ?? cue.x,
      cy = y ?? cue.y;
    if (state.hand && x !== undefined && y !== undefined) {
      await page.locator("#place").click();
      await canvas.click({ position: at(cx, cy) });
    }
    // Choose the farthest visible point along the cue to minimize pixel rounding.
    const dx = Math.cos(angle),
      dy = Math.sin(angle);
    const run = Math.min(
      700,
      dx > 0 ? (925 - cx) / dx : (-25 - cx) / dx,
      dy > 0 ? (475 - cy) / dy : (-25 - cy) / dy,
    );
    const point = at(cx + dx * run, cy + dy * run);
    await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
    await page.locator("#power").fill(String(Math.round(power * 100)));
    const shots = state.shots;
    await page.locator("#shoot").click();
    const deadline = Date.now() + 15000;
    while (state.shots === shots && Date.now() < deadline)
      await page.waitForTimeout(80);
    assert.ok(state.shots > shots, "Shot did not settle on both clients");
    if (process.env.POOL_QUICK) break;
  }
  if (state.winner !== null) {
    for (const page of pages) {
      await page.locator("#result").waitFor();
      await page.locator("#again").click();
    }
    await host.waitForFunction(() => document.querySelector("#result").hidden);
    assert.equal(starts, 2);
    assert.equal(state.shots, 0);
    assert.equal(state.turn, 1);
  }
  await guest.close();
  await host.waitForFunction(
    () => document.querySelector("#mode").textContent === "Solo vs. bot",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Pool verified on",
    url,
    "including two seats, shots, room capacity, and bot fallback.",
    starts === 2 ? "Finished rack and rematch." : "Quick check.",
  );
} finally {
  await browser.close();
}
