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
const context = await browser.newContext({
  viewport: { width: 1280, height: 850 },
  recordVideo: { dir: "output/playwright/motion-video" },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5173");
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  await page.waitForTimeout(500);
  const sample = () =>
    page.evaluate(() => {
      const g = window.__doodles;
      return {
        ads: g.viewMotion.ads,
        fov: g.render.camera.fov,
        x: g.weaponMesh.position.x,
        pitch: g.player.pitch,
        yaw: g.player.yaw,
        shots: g.combat.shots,
      };
    });
  await page.keyboard.down("KeyW");
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.keyboard.up("KeyW");
  assert.ok((await sample()).shots > 0);
  await page.screenshot({ path: "output/playwright/motion-hip-fire.png" });
  await page.mouse.down({ button: "right" });
  await page.waitForFunction(() => window.__doodles.viewMotion.ads > 0.1);
  const midway = await sample();
  await page.mouse.up({ button: "right" });
  await page.waitForFunction(
    (a) => window.__doodles.viewMotion.ads < a,
    midway.ads,
  );
  const reverse = await sample();
  assert.ok(reverse.ads < midway.ads, "ADS reverses on release");
  await page.mouse.down({ button: "right" });
  await page.waitForFunction(() => window.__doodles.viewMotion.ads > 0.995);
  const ads = await sample();
  assert.ok(ads.ads > 0.99);
  assert.ok(Math.abs(ads.x) < 0.001);
  // Headless pointer lock warps the cursor on synthetic clicks; level the screenshot fixture.
  await page.evaluate(() => {
    window.__doodles.player.pitch = 0;
    window.__doodles.updateVisuals(0);
  });
  await page.screenshot({ path: "output/playwright/motion-ads.png" });
  await page.mouse.move(660, 425);
  await page.waitForTimeout(200);
  const stopped = await sample();
  await page.waitForTimeout(250);
  const settled = await sample();
  assert.equal(stopped.pitch, settled.pitch);
  assert.equal(stopped.yaw, settled.yaw);
  await page.mouse.up({ button: "right" });
  // Use one deterministic stair approach fixture, then the real controller follows its route.
  const stairs = await page.evaluate(async () => {
    const g = window.__doodles,
      b = g.city.buildings[0];
    g.player.reset(b.entrance);
    for (let i = 0; i < 30; i++) g.step(1 / 120);
    const up = [b.inside, ...b.route];
    const route = [...up, ...up.slice().reverse(), b.entrance];
    let steps = 0,
      maxBody = 0,
      maxEye = 0,
      maxAnyEye = 0,
      maxRawEye = 0,
      stanceChanges = 0;
    for (const point of route) {
      for (let i = 0; i < 1600; i++) {
        const p = g.player,
          dx = point[0] - p.position.x,
          dz = point[2] - p.position.z;
        if (
          Math.hypot(dx, dz) < 0.24 &&
          Math.abs(p.position.y - point[1]) < 0.45
        )
          break;
        p.yaw = Math.atan2(-dx, -dz);
        const oldHeight = p.height;
        const old = p.eye.y,
          eye = g.viewMotion.eyeY;
        g.keys.add("KeyW");
        g.step(1 / 120);
        g.keys.delete("KeyW");
        maxAnyEye = Math.max(maxAnyEye, Math.abs(g.viewMotion.eyeY - eye));
        maxRawEye = Math.max(maxRawEye, Math.abs(p.eye.y - old));
        if (oldHeight !== p.height) stanceChanges++;
        if (p.grounded && p.eye.y - old > 0.025 && p.eye.y - old < 0.4) {
          steps++;
          maxBody = Math.max(maxBody, p.eye.y - old);
          maxEye = Math.max(maxEye, g.viewMotion.eyeY - eye);
        }
      }
    }
    g.player.pitch = -0.15;
    g.updateVisuals(1 / 60);
    return {
      steps,
      maxBody,
      maxEye,
      maxAnyEye,
      maxRawEye,
      stanceChanges,
      y: g.player.position.y,
      destination: b.entrance[1],
    };
  });
  console.log({ stairs });
  assert.ok(stairs.steps > 5);
  assert.ok(stairs.maxEye < stairs.maxBody * 0.7);
  assert.ok(Math.abs(stairs.y - stairs.destination) < 0.5);
  assert.equal(
    stairs.stanceChanges,
    0,
    "stairs must not force crouch/stand oscillations",
  );
  assert.ok(
    stairs.maxAnyEye < 0.06,
    "every-frame camera displacement must remain bounded, including stance changes",
  );
  await page.screenshot({ path: "output/playwright/motion-roof.png" });
  assert.deepEqual(errors, []);
  const results = { midway, reverse, ads, stairs, errors };
  await writeFile(
    "output/playwright/motion-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log(results);
} finally {
  await context.close();
  await browser.close();
}
