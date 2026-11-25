// Race: quick chips tapped while the sheet is animating toggle the filter and never move the sheet.
// Own context: a phone with touch, motion allowed (the harness forces reduced motion, which skips the animation under test).
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "no-preference" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    const sheet = p.locator("#sheet");
    await p.locator("#qr2 .chip").first().waitFor();
    assert.equal(await sheet.getAttribute("data-snap"), "half");
    const food = p.locator('[data-chip="food"]');
    const halfY = await sheet.evaluate((el) => Math.max(0, el.offsetHeight - Math.round(innerHeight * 0.46)));

    // Full hides the header (chips too); go back to half and tap a chip while the sheet is still animating up.
    await p.locator('.seg button[data-seg="list"]').tap();
    await p.waitForTimeout(600);
    assert.equal(await sheet.getAttribute("data-snap"), "full");
    await p.locator('.seg button[data-seg="map"]').tap();
    await p.waitForTimeout(60);
    await food.tap();
    assert.equal(await food.getAttribute("aria-pressed"), "true", "a chip tapped during the sheet animation toggles on");
    assert.equal(await sheet.getAttribute("data-snap"), "half", "a chip tap must not change the sheet snap");
    await p.waitForTimeout(600);
    assert.equal(await sheet.evaluate((el) => el.style.transform), `translateY(${halfY}px)`, "the sheet settles at half, untouched by the chip tap");

    // Toggle off again when settled: the snap does not move either.
    await food.tap();
    assert.equal(await food.getAttribute("aria-pressed"), "false");
    assert.equal(await sheet.evaluate((el) => el.style.transform), `translateY(${halfY}px)`);
  } finally {
    await ctx.close();
  }
}
