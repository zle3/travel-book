// Race: the Shows range chips get the same edge fade and scroll-snap as the quick chips.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    await p.locator('#bar [data-tab="shows"]').tap();
    const rng = p.locator("#shows .rng");
    await rng.waitFor();
    const css = await rng.evaluate((el) => { const c = getComputedStyle(el); return { mask: c.maskImage || c.webkitMaskImage, snap: c.scrollSnapType, align: getComputedStyle(el.querySelector(".chip")).scrollSnapAlign }; });
    assert.match(css.mask, /linear-gradient/, "right edge fades");
    assert.match(css.snap, /x/, "chips snap horizontally");
    assert.match(css.align, /start/, "each chip snaps to start");
  } finally {
    await ctx.close();
  }
}
