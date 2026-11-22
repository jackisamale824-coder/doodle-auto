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
try {
  const page = await browser.newPage({
      viewport: { width: 1280, height: 850 },
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.GAME_URL || "http://127.0.0.1:5199");
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.keyboard.press("Digit4");
  await page.waitForFunction(
    () => document.querySelector("#weapon-name").textContent === "LONGSHOT",
  );
  await page.evaluate(() => {
    const g = window.__doodles;
    if (g) {
      g.player.pitch = 0;
      g.player.yaw = 0;
    }
  });
  await page.screenshot({ path: "output/playwright/sniper-hip.png" });
  await page.mouse.down({ button: "right" });
  await page.waitForFunction(
    () => Number(document.querySelector("#sniper-scope").style.opacity) > 0.98,
  );
  await page.screenshot({ path: "output/playwright/sniper-scope.png" });
  await page.mouse.down({ button: "left" });
  await page.waitForFunction(
    () => Number(document.querySelector("#ammo").textContent) === 4,
  );
  await page.mouse.up({ button: "left" });
  await page.mouse.up({ button: "right" });
  await page.keyboard.press("Digit1");
  await page.waitForFunction(
    () => document.querySelector("#sniper-scope").style.opacity === "0",
  );
  assert.deepEqual(errors, []);
  console.log(
    "Sniper browser checks passed: slot 4, scope, firing, switching out.",
  );
} finally {
  await browser.close();
}
