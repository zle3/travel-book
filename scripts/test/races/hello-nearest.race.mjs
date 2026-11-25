// Race: the "Places in view, nearest to the middle..." line is gone while Sort is Nearest (the default); other orders keep a caption.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    const vis = () => p.locator("#hello").isVisible();
    assert.equal(await vis(), false, "no hello line under Sort: Nearest");
    await p.locator('[data-act="sort"]').tap();
    await p.locator('#sortmenu button', { hasText: "A to Z" }).tap();
    assert.equal(await vis(), true, "A-Z still explains itself");
  } finally {
    await ctx.close();
  }
}
