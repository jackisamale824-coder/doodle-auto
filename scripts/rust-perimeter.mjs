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
  await page.goto("http://127.0.0.1:5185");
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.screenshot({ path: "output/playwright/rust-shading.png" });
  await page.evaluate(() => {
    const p = window.__doodles.player;
    p.reset([21, 8, 8]);
    p.yaw = -Math.PI / 2;
    p.pitch = 0;
    p.velocity.set(60, 0, 0);
  });
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  await page.waitForTimeout(1800);
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");
  const wallStop = await page.evaluate(() =>
    window.__doodles.player.position.toArray(),
  );
  assert.ok(
    wallStop[0] < 24.563 && wallStop[0] > 22,
    "airborne sprint must stop at model perimeter",
  );
  await page.screenshot({ path: "output/playwright/rust-boundary.png" });

  await page.evaluate(() => {
    const g = window.__doodles;
    g.player.reset([48, 3, 8]);
    g.player.yaw = -Math.PI / 2;
    g.player.pitch = -0.06;
  });
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  await page.waitForFunction(
    () => window.__doodles.player.position.x > 57,
    null,
    { timeout: 15000 },
  );
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");
  await page.waitForFunction(() => window.__doodles.player.grounded);
  await page.screenshot({ path: "output/playwright/rust-desert.png" });
  const result = await page.evaluate(() => ({
    bounds: window.__doodles.city.bounds,
    position: window.__doodles.player.position.toArray(),
    grounded: window.__doodles.player.grounded,
  }));
  assert.ok(result.position[0] > 57);
  assert.equal(result.bounds, 120);
  await page.evaluate(() => {
    const g = window.__doodles;
    g.state = "paused";
    g.player.reset([70, 20, 55]);
    g.player.yaw = 0.85;
    g.player.pitch = -0.26;
    g.updateVisuals(0);
  });
  await page.screenshot({
    path: "output/playwright/rust-extended-overview.png",
  });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ wallStop, result, errors }));
} finally {
  await browser.close();
}
