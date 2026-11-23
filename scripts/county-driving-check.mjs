import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run against the dev server, which exposes the rendered car and camera.
const origin = process.env.COUNTY_TEST_ORIGIN ?? "http://127.0.0.1:4173";
const browser = await chromium.launch(
  process.env.COUNTY_HARDWARE_GL === "1"
    ? {
        channel: "chromium",
        args: [
          "--enable-gpu",
          "--ignore-gpu-blocklist",
          "--use-angle=gl",
          "--ozone-platform=x11",
        ],
      }
    : {},
);
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await page.goto(new URL("/?mode=county", origin).href);
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.waitForFunction(() => window.__doodles?.state === "play");
  await page.keyboard.press("KeyE");
  await page.waitForFunction(() => window.__doodles.vehicle >= 0);
  await page.keyboard.down("KeyW");
  await page.waitForFunction(() => window.__doodles.carSpeed > 8);
  const result = await page.evaluate(async () => {
    const game = window.__doodles,
      car = game.render.countyCars[game.vehicle],
      camera = game.render.camera;
    const start = car.position.clone(),
      relative = start.clone(),
      frames = [];
    let maxError = 0,
      previous = performance.now();
    for (let i = 0; i < 180; i++) {
      await new Promise(requestAnimationFrame);
      const now = performance.now();
      frames.push(now - previous);
      previous = now;
      relative.copy(camera.position);
      car.worldToLocal(relative);
      maxError = Math.max(
        maxError,
        Math.hypot(relative.x, relative.y - 3.1, relative.z - 6),
      );
    }
    frames.sort((a, b) => a - b);
    return {
      metres: car.position.distanceTo(start),
      maxCameraErrorMetres: maxError,
      meanFPS: (1000 * frames.length) / frames.reduce((a, b) => a + b),
      p95FrameMs: frames[Math.floor(frames.length * 0.95)],
    };
  });
  await page.keyboard.up("KeyW");
  assert.ok(result.metres > 15, "The car must travel along the street");
  assert.ok(
    result.maxCameraErrorMetres < 0.005,
    "The chase camera moved relative to the car",
  );
  console.log(result);
} finally {
  await browser.close();
}
