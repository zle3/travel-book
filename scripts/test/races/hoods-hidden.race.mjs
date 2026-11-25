// Race: San Francisco neighborhoods stay hidden and unfetched until the visitor picks San Francisco (the map sitting on SF is not a pick).
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    const asked = [];
    p.on("request", (r) => { if (/\/data\/hoods\//.test(r.url())) asked.push(r.url()); });
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/?debug", { waitUntil: "load" });
    await p.locator("#listBody .gcard").first().waitFor(); // the map is on SF and the guides show
    await p.waitForFunction(() => !!window.__tbApp?.ctl);
    assert.equal(await p.locator("#listBody .hsec").count(), 0, "no neighborhood list before a pick");
    assert.ok(!/DataSF/.test((await p.locator("#credit").textContent()) ?? ""), "no DataSF credit while the layer is off");
    assert.equal(await p.evaluate(() => { const m = window.__tbApp.ctl.map; return m.getLayer("hoods-line") ? m.getLayoutProperty("hoods-line", "visibility") : "none"; }), "none", "outline layer hidden");
    assert.equal(asked.length, 0, `the hoods file is not fetched (${asked})`);
  } finally { await ctx.close(); }
}
