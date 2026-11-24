import { enterGuest } from "./guest-session.mjs";
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const url = process.env.GAME_URL || "http://127.0.0.1:5174";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const errors = [],
  checks = [];
async function player(name) {
  const page = await browser.newPage({
    viewport: { width: 640, height: 480 },
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("crash", () => console.error("RENDERER CRASH"));
  console.log("Opening", name);
  await page.goto(url);
  await enterGuest(page, name);
  await page.waitForSelector("#menu:not(.hidden)", { timeout: 60000 });
  assert.equal(
    await page.locator("#public-mode").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#play").click();
  await page.locator("#equip-kit").click();
  console.log("Joining", name);
  await page.waitForSelector("#hud:not(.hidden)", { timeout: 60000 });
  await page.waitForFunction(
    () => !!document.pointerLockElement || !!document.querySelector("#resume"),
  );
  if (await page.locator("#resume").isVisible())
    await page.locator("#resume").click();
  await page.waitForFunction(() => !!document.pointerLockElement);
  return page;
}
try {
  const a = await player("Public Alice");
  const b = await player("Public Bob");
  await b.keyboard.down("Tab");
  await b.waitForFunction(
    () =>
      document.querySelector("#board").textContent.includes("Public Alice") &&
      document.querySelector("#board").textContent.includes("[NPC]"),
  );
  const board = await b.locator("#board").innerText();
  assert.ok(board.includes("Public Bob"));
  assert.equal((board.match(/\[NPC\]/g) || []).length, 8);
  checks.push(
    "Default Play joins one public lobby without a code; two browsers see each other and eight shared NPCs",
  );
  const label = await b.locator("#room-badge").innerText();
  assert.ok(label.includes("2 PLAYERS"));
  console.log("Shared roster verified");
  await b.keyboard.up("Tab");
  await b.mouse.down();
  await b.waitForFunction(
    () => Number(document.querySelector("#ammo").textContent) < 30,
  );
  await b.mouse.up();
  await b.keyboard.down("KeyR");
  await b.waitForTimeout(750);
  await b.keyboard.up("KeyR");
  await b.waitForFunction(
    () => Number(document.querySelector("#ammo").textContent) === 30,
    null,
    { timeout: 15000 },
  );
  checks.push("Immediate firing and reload work in the public match");
  console.log("Firing and reload verified");
  await b.keyboard.down("Tab");
  await b.screenshot({ path: "output/playwright/public-lobby-shared.png" });
  await b.keyboard.up("Tab");
  const rtt = await b.locator("#room-badge").innerText();
  await a.close();
  await b.waitForFunction(() =>
    document.querySelector("#room-badge").textContent.includes("1 PLAYERS"),
  );
  checks.push("Disconnect removes a human while shared NPCs remain");
  assert.deepEqual(errors, []);
  const result = { url, checks, rtt, errors };
  await writeFile(
    "output/playwright/public-lobby-results.json",
    JSON.stringify(result, null, 2),
  );
  console.log(result);
} catch (error) {
  console.error("Browser errors", errors);
  throw error;
} finally {
  await browser.close();
}
