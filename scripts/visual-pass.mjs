import { enterGuest } from "./guest-session.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
const pass = process.env.PASS || "1";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5173");
  await enterGuest(page);
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await page.screenshot({ path: `output/playwright/style-${pass}-menu.png` });
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.locator("#equip-kit").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.evaluate(() => {
    const g = window.__doodles;
    g.player.pitch = 0;
    g.player.yaw = 0;
    g.updateVisuals(1 / 60);
  });
  await page.screenshot({ path: `output/playwright/style-${pass}-game.png` });
  await page.keyboard.press("Escape");
  await page.locator("#main-menu").click();
  await page.locator("#online").click();
  await page.locator("#equip-kit").click();
  await page.locator("#create-room").click();
  await page.waitForSelector("#enter-room", { timeout: 30000 });
  await page.screenshot({ path: `output/playwright/style-${pass}-online.png` });
  const invite = await page.locator("#invite-link").inputValue();
  const other = await browser.newPage({
    viewport: { width: 1000, height: 800 },
  });
  await other.goto(invite);
  await enterGuest(other, "Invite friend");
  await other.locator("#equip-kit").click();
  await other.waitForSelector("#join-room", { timeout: 60000 });
  assert.equal(
    await other.locator("#room-input").inputValue(),
    new URL(invite).searchParams.get("room"),
  );
  await other.locator("#join-room").click();
  await other.waitForSelector("#enter-room", { timeout: 30000 });
  assert.equal(
    await other.locator(".room-code").textContent(),
    new URL(invite).searchParams.get("room"),
  );
  await other.close();
  await page.locator("#close-dialog").click();
  // Responsive menu check in a separate page avoids disrupting the active room.
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await mobile.goto("http://127.0.0.1:5173");
  await enterGuest(mobile);
  await mobile.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await mobile.screenshot({
    path: `output/playwright/style-${pass}-mobile.png`,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS",
    pass,
    "menu, game, invite join, responsive menu; no runtime errors",
  );
} finally {
  await browser.close();
}
