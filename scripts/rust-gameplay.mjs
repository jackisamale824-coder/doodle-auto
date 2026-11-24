import { enterGuest } from "./guest-session.mjs";
import { chromium } from "playwright";
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
const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5182/?mode=rust");
  await enterGuest(page);
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 90000 });
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.locator("#equip-kit").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.screenshot({ path: "output/playwright/rust-spawn-final.png" });
  const ladder = await page.evaluate(() => {
    const g = window.__doodles,
      l = g.city.arena.ladders[0];
    g.player.reset([l.x, l.bottom + 0.06, l.z]);
    g.player.yaw = 0;
    return l;
  });
  await page.keyboard.down("KeyW");
  await page.waitForFunction(
    (top) => window.__doodles.player.position.y >= top,
    ladder.top,
    { timeout: 15000 },
  );
  await page.keyboard.up("KeyW");
  await page.waitForTimeout(500);
  await page.screenshot({ path: "output/playwright/rust-ladder-final.png" });
  const exit = await page.evaluate(() =>
    window.__doodles.player.position.toArray(),
  );
  assert.ok(exit[1] >= ladder.top - 0.2);
  await page.mouse.down();
  await page.waitForFunction(() => window.__doodles.combat.mags[0] < 30);
  await page.mouse.up();
  await page.evaluate(() => {
    const g = window.__doodles;
    g.player.reset([5, 1, 0]);
    g.player.yaw = Math.PI / 2;
    g.player.pitch = 0.3;
  });
  await page.keyboard.down("KeyQ");
  await page.waitForFunction(
    () => !!window.__doodles.player.anchor,
    {},
    { timeout: 10000 },
  );
  await page.keyboard.up("KeyQ");
  await page.waitForTimeout(300);
  const grapple = await page.evaluate(() => ({
    anchor: window.__doodles.player.anchor,
    speed: window.__doodles.player.velocity.length(),
  }));
  assert.ok(grapple.anchor);
  await page.screenshot({ path: "output/playwright/rust-grapple-final.png" });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ladderExit: exit, grapple, errors }));
} finally {
  await browser.close();
}
