import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const url = process.env.GAME_URL || "http://127.0.0.1:4173";
const errors = [],
  checks = [];
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    ...(process.env.PUBLIC_HOST_IP
      ? [
          `--host-resolver-rules=MAP ${new URL(url).hostname} ${process.env.PUBLIC_HOST_IP}`,
        ]
      : []),
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  assert.equal((await (await fetch(url + "/health")).json()).ok, true);
  checks.push("Production health endpoint");
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  assert.equal(await page.evaluate(() => typeof window.__doodles), "undefined");
  await page.screenshot({ path: "output/playwright/production-menu.png" });
  checks.push(
    "Production assets, WebGL city and bundled fonts load without development hooks",
  );
  await page.locator("#roam-mode").click();
  await page.locator("#play").click();
  await page.waitForFunction(() => !!document.pointerLockElement, {
    timeout: 15000,
  });
  await page.keyboard.down("KeyW");
  await page.keyboard.down("ShiftLeft");
  await page.waitForFunction(
    () => Number(document.querySelector("#speed").textContent) > 10,
    { timeout: 15000 },
  );
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");
  checks.push(
    "First-person pointer lock and sprint input work on the served origin",
  );
  await page.mouse.down();
  await page.waitForFunction(
    () => Number(document.querySelector("#ammo").textContent) < 30,
    { timeout: 15000 },
  );
  await page.mouse.up();
  await page.screenshot({ path: "output/playwright/production-game.png" });
  checks.push("Arcade weapon firing consumes ammunition");
  await page.keyboard.press("Escape");
  await page.waitForSelector("#main-menu");
  await page.locator("#main-menu").click();
  await page.locator("#online").click();
  await page.locator("#player-name").fill("Bluebird");
  await page.locator("#create-room").click();
  await page.waitForSelector("#enter-room", { timeout: 30000 });
  const code = (await page.locator(".room-code").innerText()).trim();
  const invite = await page.locator("#invite-link").inputValue();
  assert.equal(new URL(invite).searchParams.get("room"), code);
  await page.locator("#enter-room").click();
  const other = await browser.newPage({
    viewport: { width: 1000, height: 700 },
  });
  other.on("pageerror", (e) => errors.push(e.message));
  await other.goto(invite, { waitUntil: "networkidle" });
  await other.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  await other.waitForSelector("#join-room");
  assert.equal(await other.locator("#room-input").inputValue(), code);
  await other.locator("#player-name").fill("Marginalia");
  await other.locator("#room-input").fill(code);
  await other.locator("#join-room").click();
  await other.waitForSelector("#hud:not(.hidden)", { timeout: 30000 });
  if (await other.locator("#resume").isVisible())
    await other.locator("#resume").click();
  await other.waitForFunction(() => !!document.pointerLockElement);
  await other.keyboard.down("Tab");
  await other.waitForFunction(
    () =>
      document.querySelector("#board").textContent.includes("Bluebird") &&
      document.querySelector("#board").textContent.includes("Marginalia"),
  );
  await other.screenshot({
    path: "output/playwright/production-multiplayer.png",
  });
  checks.push(
    "Two production browser clients create/join via invite link and share the scoreboard",
  );
  await other.close();
  assert.deepEqual(errors, []);
  checks.push("No runtime or WebGL errors");
} catch (e) {
  errors.push(e.stack);
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(
    "output/playwright/production-results.json",
    JSON.stringify({ url, checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ url, checks, errors }, null, 2));
}
