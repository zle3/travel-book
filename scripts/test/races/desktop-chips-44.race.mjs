// Race: on desktop every chip, toggle and control in the panel and on the map is at least 44px tall (it was 34 to 36).
import assert from "node:assert/strict";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    const small = await p.evaluate(() => [...document.querySelectorAll("#chips button, .fbtn, .sortb, .ctl .cb2, .topr .tb")]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden")
      .map((el) => [el.className || el.tagName, Math.round(el.getBoundingClientRect().height * 10) / 10])
      .filter(([, h]) => h < 44));
    assert.deepEqual(small, [], "every desktop control is at least 44px tall");
  } finally {
    await ctx.close();
  }
}
