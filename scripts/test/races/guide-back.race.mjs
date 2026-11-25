// Race: the back button returns from a guide to the normal feed and clears the deep link.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    await p.locator("#listBody .gcard").first().tap();
    await p.locator("#listBody .ghead").waitFor();
    assert.match(p.url(), /#guide=inner-richmond$/, "the guide has a shareable link");
    await p.locator('#listBody [data-act="guideBack"]').tap();
    await p.locator("#listBody .gcard").first().waitFor();
    assert.equal(await p.evaluate(() => document.activeElement?.getAttribute("data-guide")), "inner-richmond", "focus returns to the card that opened the guide");
    assert.equal(await p.locator("#listBody .ghead").count(), 0, "guide header gone");
    assert.ok(await p.locator("#listBody .row").count() > 5, "the normal feed is back");
    assert.ok(!/guide=/.test(p.url()), "the link is cleared");
  } finally {
    await ctx.close();
  }
}
