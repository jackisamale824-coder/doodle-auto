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
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5177");
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 90000 });
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.locator("#equip-kit").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  const stats = await page.evaluate(() => {
    const g = window.__doodles;
    return {
      buildings: g.city.buildings.length,
      maxHeight: Math.max(...g.city.buildings.map((b) => b.height)),
      bridges: g.city.bridges.length,
      blimps: g.city.blimps.length,
      platforms: g.city.platforms.length,
    };
  });
  await page.evaluate(() => {
    const g = window.__doodles;
    g.state = "paused";
    g.player.reset([120, 100, 180]);
    g.player.yaw = 0.35;
    g.player.pitch = -0.4;
    g.updateVisuals(0);
  });
  console.log("overview", stats);
  await page.screenshot({ path: "output/playwright/aerial-overview.png" });
  const end = await page.evaluate(() => {
    const g = window.__doodles;
    const b = g.city.bridges.find((b) => b.from[1] > 30);
    g.player.reset([b.from[0], b.from[1] + 0.05, b.from[2] - 1]);
    g.player.yaw = Math.PI;
    g.player.pitch = -0.08;
    g.state = "play";
    return b.to[2];
  });
  console.log(
    "bridge start",
    await page.evaluate(() => ({
      state: window.__doodles.state,
      p: window.__doodles.player.position.toArray(),
      yaw: window.__doodles.player.yaw,
      lock: !!document.pointerLockElement,
    })),
  );
  await page.keyboard.down("KeyW");
  await page.waitForFunction(
    (end) => window.__doodles.player.position.z > end + 0.5,
    end,
    { timeout: 20000 },
  );
  await page.keyboard.up("KeyW");
  await page.evaluate(() => {
    const g = window.__doodles;
    g.state = "paused";
    g.player.yaw = 0;
    g.updateVisuals(0);
  });
  await page.screenshot({ path: "output/playwright/aerial-bridge.png" });
  await page.evaluate(() => {
    const g = window.__doodles;
    const h = g.player.movingHooks()[0];
    g.player.reset([h.position[0], h.position[1] - 8, h.position[2] + 18]);
    g.player.yaw = 0;
    g.player.pitch = Math.atan2(h.position[1] - g.player.eye.y, 18);
    g.state = "play";
    g.updateVisuals(0);
  });
  await page.keyboard.down("KeyQ");
  await page.waitForFunction(() => !!window.__doodles.player.movingAnchor, {
    timeout: 10000,
  });
  await page.keyboard.up("KeyQ");
  const first = await page.evaluate(() => ({
    ...window.__doodles.player.anchor,
  }));
  await page.waitForTimeout(1100);
  const moving = await page.evaluate(() => {
    const g = window.__doodles;
    const h = g.player
      .movingHooks()
      .find((h) => h.id === g.player.movingAnchor);
    return {
      anchor: { ...g.player.anchor },
      target: h?.position,
      id: g.player.movingAnchor,
    };
  });
  assert.ok(moving.id);
  assert.ok(
    Math.hypot(moving.anchor.x - first.x, moving.anchor.z - first.z) > 0.1,
  );
  assert.ok(Math.abs(moving.anchor.x - moving.target[0]) < 0.3);
  await page.screenshot({ path: "output/playwright/aerial-blimp.png" });
  await page.keyboard.down("KeyQ");
  await page.waitForFunction(() => window.__doodles.player.anchor === null);
  await page.keyboard.up("KeyQ");
  assert.equal(await page.evaluate(() => window.__doodles.player.anchor), null);
  assert.deepEqual(errors, []);
  await writeFile(
    "output/playwright/aerial-results.json",
    JSON.stringify({ stats, moving, errors }, null, 2),
  );
  console.log(JSON.stringify({ stats, moving, errors }));
} catch (e) {
  console.log(
    "failure state",
    await page
      .evaluate(() => ({
        state: window.__doodles?.state,
        p: window.__doodles?.player.position.toArray(),
        yaw: window.__doodles?.player.yaw,
        keys: [...window.__doodles.keys],
        lock: !!document.pointerLockElement,
      }))
      .catch(() => null),
  );
  throw e;
} finally {
  await browser.close();
}
