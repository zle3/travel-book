// Race: the search placeholder is short ("Search places"; fits a 390px phone); the long wording stays in the aria-label.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    assert.equal(await p.locator("#q").getAttribute("placeholder"), "Search places");
    assert.match((await p.locator("#q").getAttribute("aria-label")) ?? "", /ZIP/, "the long text stays as the accessible name");
  } finally {
    await ctx.close();
  }
}
