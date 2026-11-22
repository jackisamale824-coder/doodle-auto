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
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(process.env.GAME_URL || "http://127.0.0.1:5199");
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  const info = await page.evaluate(() => {
    const g = window.__doodles,
      p = g.player;
    g.state = "paused";
    g.keys.clear();
    p.velocity.set(0, 0, 0);
    let hit;
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.1) {
      p.yaw = yaw;
      p.pitch = 0.15;
      hit = p.grappleHit();
      if (hit && hit.distance > 12 && hit.distance < 70) break;
    }
    if (!hit) throw Error("No visible wall fixture");
    p.update(1 / 120, {
      forward: 0,
      side: 0,
      sprint: false,
      crouch: false,
      jump: false,
      grapple: true,
      reel: false,
    });
    if (!p.anchor) throw Error("Hook did not attach");
    g.updateVisuals(0.1);
    g.render.draw(g.time);
    return { anchor: p.anchor, distance: hit.distance };
  });
  await page.screenshot({ path: "output/playwright/grapple-attached.png" });
  await page.evaluate(() => {
    const g = window.__doodles;
    g.player.yaw += 0.35;
    g.updateVisuals(0.1);
    g.render.draw(g.time);
  });
  await page.screenshot({ path: "output/playwright/grapple-side-view.png" });
  const wrap = await page.evaluate(async () => {
    const T = await import("/node_modules/three/build/three.module.js");
    const { Physics, Controller, idleInput } = await import("/src/physics.ts");
    const { outlinedBox, inkMaterial } = await import("/src/render.ts");
    const g = window.__doodles;
    g.state = "paused";
    const box = { p: [0, 105, -5], s: [8, 10, 1], solid: true, kind: "wall" };
    const ph = await Physics.create([box]);
    const p = new Controller(ph, [0, 103, 0]);
    p.anchor = { x: 0, y: 104.6, z: -10 };
    p.ropeLength = 12;
    p.update(1 / 120, idleInput());
    if (!p.anchor || p.ropePath.length < 2) throw Error("Rope failed to wrap");
    const group = new T.Group();
    outlinedBox(box.s, box.p, inkMaterial(), group);
    g.render.scene.add(group);
    g.player = p;
    g.viewMotion.reset?.();
    p.yaw = 0.5;
    g.updateVisuals(0.1);
    g.render.draw(g.time);
    return {
      contacts: p.ropePath.map((p) => p.toArray()),
      attached: !!p.anchor,
    };
  });
  await page.screenshot({ path: "output/playwright/grapple-wrapped.png" });
  console.log("Wrapped cable rendered:", wrap);
  assert.deepEqual(errors, []);
  console.log("Hook visual browser checks passed", info);
} finally {
  await browser.close();
}
