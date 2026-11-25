// Race: on a phone the theme toggle is a visible sun/moon button in the Key sheet header (not in the crowded top bar), 44px, and it switches the theme.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    assert.equal(await p.locator("#themeBtn").isVisible(), false, "the desktop toggle stays out of the phone top bar");
    await p.locator(".keyb").tap();
    const b = p.locator("#legendHost [data-themebtn]");
    await b.waitFor();
    const box = await b.boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `theme button is a 44px target (${box.width}x${box.height})`);
    const before = await p.evaluate(() => document.documentElement.dataset.theme);
    await b.tap();
    const after = await p.evaluate(() => document.documentElement.dataset.theme);
    assert.notEqual(after, before, "tapping it switches the theme");
    assert.match((await b.getAttribute("aria-label")) ?? "", after === "light" ? /dark/ : /light/, "its label names the other theme");
  } finally {
    await ctx.close();
  }
}
