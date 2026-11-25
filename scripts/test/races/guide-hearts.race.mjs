// Race: hearts and picks work on guide rows, including guide-only pins (no saved place behind them).
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
    const hearts = p.locator("#listBody .row .heart");
    await hearts.first().tap();
    assert.equal(await hearts.first().getAttribute("aria-pressed"), "true");
    const guideOnly = p.locator('#listBody .row:has(.rn:text-is("Mountain Lake Park")) .heart');
    await guideOnly.scrollIntoViewIfNeeded();
    await guideOnly.tap();
    assert.equal(await guideOnly.getAttribute("aria-pressed"), "true", "a guide-only place can be hearted");
    assert.equal((await p.locator("#bar [data-picks-pill]").textContent())?.trim(), "2", "both are in picks");
    await p.locator('#bar [data-tab="picks"]').tap();
    assert.ok((await p.locator("#picksHost").textContent())?.includes("Mountain Lake Park"), "the guide-only pick is listed in Your picks");
  } finally {
    await ctx.close();
  }
}
