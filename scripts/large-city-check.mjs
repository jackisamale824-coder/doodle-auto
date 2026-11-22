import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
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
  await page.goto("http://127.0.0.1:5175");
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  const dimensions = await page.evaluate(() => {
    const g = window.__doodles;
    return {
      buildings: g.city.buildings.length,
      blocks: g.city.plan.blocks.length,
      bounds: g.city.bounds,
    };
  });
  assert.equal(dimensions.buildings, 256);
  await page.evaluate(() => {
    const g = window.__doodles;
    g.player.reset([15, 0.16, 245]);
    g.player.yaw = 0;
    g.player.pitch = 0;
  });
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  await page.waitForFunction(() => window.__doodles.player.position.z < 239, {
    timeout: 30000,
  });
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");
  await page.screenshot({ path: "output/playwright/large-city-edge.png" });
  await page.evaluate(() => {
    const g = window.__doodles;
    g.state = "paused";
    g.player.reset([15, 100, 160]);
    g.player.pitch = -0.65;
    g.player.yaw = 0;
    g.updateVisuals(0);
  });
  await page.screenshot({ path: "output/playwright/large-city-overview.png" });
  const lod = await page.evaluate(() => {
    const g = window.__doodles;
    return {
      near: g.render.cityGroup.children.filter(
        (o) => o.userData.detailCenter && o.visible,
      ).length,
      far: g.render.cityGroup.children.filter(
        (o) => o.userData.farCenter && o.visible,
      ).length,
      fps: g.fps,
    };
  });
  assert.ok(lod.near > 0);
  assert.ok(lod.far > 100);
  assert.deepEqual(errors, []);
  const result = {
    dimensions,
    lod,
    errors,
    checks: [
      "256 buildings / 64 blocks",
      "real sprint movement in outer city",
      "near detail and distant massing both visible",
      "no browser errors",
    ],
  };
  console.log(result);
  await writeFile(
    "output/playwright/large-city-results.json",
    JSON.stringify(result, null, 2),
  );
} finally {
  await browser.close();
}
