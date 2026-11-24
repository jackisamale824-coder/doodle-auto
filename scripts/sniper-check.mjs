import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  await mkdir("output/playwright", { recursive: true });
  for (const [name, zoom] of [
    ["Longshot", 4],
    ["Carbine AR", 1],
    ["Ink AR", 1],
  ]) {
    const page = await browser.newPage({
      viewport: { width: 1000, height: 660 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const overlay = zoom > 1;
    const scope = page.locator(overlay ? "#sniper-scope" : "#crosshair");
    const waitForScope = (visible) =>
      page.waitForFunction(
        ({ visible, overlay }) =>
          overlay
            ? Number(document.querySelector("#sniper-scope").style.opacity) ===
              Number(visible)
            : document
                .querySelector("#crosshair")
                .classList.contains("reflex-dot") === visible,
        { visible, overlay },
      );
    await page.goto(
      process.env.GAME_URL || "http://127.0.0.1:5199/?mode=county",
    );
    await page.locator("#roam-mode").click();
    await page.locator("#play").click();
    await page.locator(".armory-card").filter({ hasText: name }).click();
    await page.locator("#equip-kit").click();
    await page.waitForFunction(() => !!document.pointerLockElement);
    assert.equal(
      await page.locator("#weapon-name").textContent(),
      name === "Ink AR" ? "INKRIFLE" : name,
    );
    await page.mouse.down({ button: "right" });
    await waitForScope(true);
    if (overlay)
      assert.equal(
        await scope.locator("#scope-label").textContent(),
        name + " · " + zoom + "×",
      );
    else
      assert.equal(
        await page
          .locator("#sniper-scope")
          .evaluate((e) => Number(e.style.opacity)),
        0,
      );
    const dot = await scope.locator(overlay ? "i" : "span").boundingBox();
    const size = page.viewportSize();
    assert.ok(Math.abs(dot.x + dot.width / 2 - size.width / 2) < 1);
    assert.ok(Math.abs(dot.y + dot.height / 2 - size.height / 2) < 1);
    await page.screenshot({
      path: "output/playwright/scope-" + name.replaceAll(" ", "-") + ".png",
    });
    const ammo = Number(await page.locator("#ammo").textContent());
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(
      (n) => Number(document.querySelector("#ammo").textContent) < n,
      ammo,
    );
    await page.keyboard.press("KeyR");
    await waitForScope(false);
    await waitForScope(true);
    await page.keyboard.press("Digit2");
    await waitForScope(false);
    assert.equal(await page.locator("#weapon-name").textContent(), "Pistol");
    await page.keyboard.press("Digit1");
    await waitForScope(true);
    await page.mouse.up({ button: "right" });
    await waitForScope(false);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(
      name +
        " passed scope alignment, firing, reload, weapon switching and aim release.",
    );
  }
} finally {
  await browser.close();
}
