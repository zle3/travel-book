// Race: picking "San Francisco" in search turns the neighborhood layer and list on; searching another city does not.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/?debug", { waitUntil: "load" });
    await p.waitForFunction(() => !!window.__tbApp?.ctl);
    await p.locator("#q").fill("oakland");
    await p.locator("#sugg .sg").first().waitFor();
    await p.locator("#sugg .sg").filter({ has: p.locator("b", { hasText: /^Oakland$/ }) }).filter({ hasText: "City, Bay Area" }).tap();
    assert.equal(await p.locator("#listBody .hsec").count(), 0, "another city does not show San Francisco neighborhoods");
    await p.locator("#q").fill("san francisco");
    const sf = p.locator("#sugg .sg").filter({ has: p.locator("b", { hasText: /^San Francisco$/ }) }).filter({ hasText: "City, Bay Area" });
    await sf.waitFor();
    await sf.tap();
    await p.locator("#listBody .hsec .hrow").first().waitFor();
    assert.equal(await p.locator("#listBody .hrow").count(), 41);
    assert.equal(await p.evaluate(() => location.hash), "#city=sf");
  } finally { await ctx.close(); }
}
