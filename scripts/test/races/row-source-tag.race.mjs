// Race: the "Other list" tag on a row only appears while both sources (My lists and Other lists) are showing.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    assert.ok(await p.locator("#listBody .row .tag").count() > 0, "with both sources on, Other-list rows are tagged");
    await p.locator("#qr1 [data-src=mine]").tap();
    assert.equal(await p.locator("#qr1 [data-src=mine]").getAttribute("aria-pressed"), "false");
    assert.ok(await p.locator("#listBody .row").count() > 0, "rows still listed");
    assert.equal(await p.locator("#listBody .row .tag").count(), 0, "with only Other lists on, the tag is redundant and not shown");
  } finally {
    await ctx.close();
  }
}
