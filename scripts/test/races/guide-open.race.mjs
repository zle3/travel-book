// Race: on San Francisco the sheet lists a Guides section; tapping Inner Richmond opens the guide view with the anchor and grouped rows.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/?debug", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    const card = p.locator('#listBody .gcard[data-guide="inner-richmond"]');
    await card.waitFor();
    assert.equal(await p.locator("#listBody .gh").first().textContent(), "Guides in San Francisco");
    await card.tap();
    await p.locator("#listBody .ghead h2").waitFor();
    assert.equal(await p.locator("#listBody .ghead h2").textContent(), "Inner Richmond");
    assert.match((await p.locator("#listBody .ganchor").textContent()) ?? "", /Volcano Curry/, "the anchor is at the top");
    assert.ok((await p.locator("#listBody .ghead .gsub").textContent())?.length, "subtitle shown");
    const rows = await p.locator("#listBody .row").count();
    assert.ok(rows >= 30, `the guide lists its places as feed rows (${rows})`);
    assert.equal(await p.locator("#listBody .gh").count(), 5, "five groups");
    assert.ok(await p.locator("#listBody .row .dst").count() === rows, "every row shows a distance (from the anchor)");
    assert.ok(!/drive|leave by|minutes?\b/i.test((await p.locator("#listBody").textContent()) ?? ""), "nothing about schedules or drive times");
  } finally {
    await ctx.close();
  }
}
