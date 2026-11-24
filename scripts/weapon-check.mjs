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
  await page.goto(process.env.GAME_URL || "http://127.0.0.1:5173/?mode=rust");
  await enterGuest(page);
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.locator("#equip-kit").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  for (let i = 0; i < 3; i++)
    for (const ads of [false, true]) {
      await page.waitForFunction(() => !!window.__doodles);
      await page.evaluate(
        ({ i, ads }) => {
          const g = window.__doodles;
          g.combat.weapon = i;
          g.setWeapon(i, true);
          g.updateHUD();
          g.player.pitch = 0;
          g.player.yaw = 0;
          g.aiming = ads;
          g.viewMotion.ads = Number(ads);
          g.updateVisuals(0);
        },
        { i, ads },
      );
      await page.screenshot({
        path: `output/playwright/weapon-${i}-${ads ? "ads" : "hip"}.png`,
      });
    }
  assert.deepEqual(errors, []);
  console.log("Six weapon views rendered without errors");
} finally {
  await browser.close();
}
