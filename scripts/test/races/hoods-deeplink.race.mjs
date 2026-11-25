// Race: #city=sf&hood=<slug> opens San Francisco with that neighborhood chosen; picking in the UI keeps the hash in step.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/?debug#city=sf&hood=north-beach", { waitUntil: "load" });
    await p.locator("#hoodTitle").waitFor();
    assert.match((await p.locator("#hoodTitle").textContent()) ?? "", /^North Beach · \d+ places$/);
    await p.waitForFunction(() => !!window.__tbApp?.ctl);
    await p.waitForFunction(() => window.__tbApp.ctl.map.getLayoutProperty("hoods-line", "visibility") === "visible");
    await p.waitForFunction(() => { const b = window.__tbApp.ctl.bounds(); return b[0] < -122.415 && b[2] > -122.40 && b[2] - b[0] < 0.07; });
    assert.equal(await p.evaluate(() => location.hash), "#city=sf&hood=north-beach");
    await p.locator('[data-act="hoodClear"]').tap();
    await p.waitForFunction(() => location.hash === "#city=sf");
    await p.locator('#listBody .hrow[data-hood="marina"]').tap();
    await p.waitForFunction(() => location.hash === "#city=sf&hood=marina");
    await p.locator('[data-act="hoodClear"]').tap();
    await p.locator('#listBody [data-act="sfOff"]').tap();
    await p.waitForFunction(() => location.hash === "");
  } finally { await ctx.close(); }
}
