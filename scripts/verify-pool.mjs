import assert from "node:assert/strict";
import { chromium } from "playwright";
import { botStroke } from "../src/pool/aim.ts";

const url = process.env.POOL_URL || "http://localhost:4173/pool/";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || undefined,
});
try {
  const touch = process.env.POOL_TOUCH === "1";
  const host = await browser.newPage({
    viewport: touch
      ? { width: 375, height: 667 }
      : { width: 1250, height: 860 },
    hasTouch: touch,
    isMobile: touch,
  });
  const guest = await browser.newPage({
    viewport: touch ? { width: 844, height: 390 } : { width: 390, height: 844 },
    hasTouch: touch,
    isMobile: touch,
  });
  const press = (locator, options) =>
    touch ? locator.tap(options) : locator.click(options);
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
  if (touch) {
    const before = await host.locator("#table").evaluate((c) => c.toDataURL());
    await press(host.locator("#aim-right"));
    await host.waitForFunction(
      (before) => document.querySelector("#table").toDataURL() !== before,
      before,
    );
    await press(host.locator("#aim-left"));
    await press(host.locator("#power"), { position: { x: 10, y: 22 } });
    assert.ok(Number(await host.locator("#power").inputValue()) < 30);
  }
  await press(host.locator("#guide"));
  assert.equal(
    await host.locator("#guide").getAttribute("aria-pressed"),
    "false",
  );
  await press(host.locator("#guide"));
  await press(host.locator("#rules"));
  await press(host.locator("#help .close"));
  if (process.env.POOL_SCREENSHOT)
    await host.screenshot({ path: process.env.POOL_SCREENSHOT });
  await press(host.locator("#online"));
  await press(host.locator("#create"));
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
      await press(page.locator("#place"));
      await press(canvas, { position: at(cx, cy) });
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
    if (touch)
      await page.touchscreen.tap(bounds.x + point.x, bounds.y + point.y);
    else await page.mouse.click(bounds.x + point.x, bounds.y + point.y);
    await page.locator("#power").fill(String(Math.round(power * 100)));
    const shots = state.shots;
    await press(page.locator("#shoot"));
    const deadline = Date.now() + 15000;
    while (state.shots === shots && Date.now() < deadline)
      await page.waitForTimeout(80);
    assert.ok(state.shots > shots, "Shot did not settle on both clients");
    if (process.env.POOL_QUICK) break;
  }
  if (state.winner !== null) {
    for (const page of pages) {
      await page.locator("#result").waitFor();
      await press(page.locator("#again"));
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
