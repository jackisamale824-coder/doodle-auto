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
  await page.goto(process.env.GAME_URL || "http://127.0.0.1:5181");
  await enterGuest(page);
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 90000 });
  await page.screenshot({ path: "output/playwright/rust-menu.png" });
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.locator("#equip-kit").click();
  if (await page.locator("#resume").isVisible())
    await page.locator("#resume").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.evaluate(() => {
    const g = window.__doodles;
    g.player.yaw = -0.4;
    g.player.pitch = 0.02;
  });
  await page.screenshot({ path: "output/playwright/rust-ground.png" });
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(600);
  await page.keyboard.up("KeyW");
  await page.evaluate(() => {
    const g = window.__doodles;
    g.state = "paused";
    g.player.reset([29, 30, 35]);
    g.player.yaw = 0.62;
    g.player.pitch = -0.57;
    g.updateVisuals(0);
  });
  await page.screenshot({ path: "output/playwright/rust-overview.png" });
  console.log(
    await page.evaluate(() => ({
      arena: window.__doodles.city.arena.name,
      colliders: window.__doodles.city.boxes.length,
      meshes: window.__doodles.render.cityGroup.children.length,
      nodes: window.__doodles.city.nodes.length,
    })),
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
