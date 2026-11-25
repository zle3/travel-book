// Race: #city=sf&hood=<slug> flies to San Francisco with that neighborhood chosen, even from a saved view elsewhere; picking in the UI keeps the hash in step.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    await ctx.addInitScript(() => { try { localStorage.setItem("tb-view", JSON.stringify({ lng: -122.27, lat: 37.80, zoom: 12.4 })); } catch {} });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/?debug#city=sf&hood=north-beach", { waitUntil: "load" });
    await p.locator("#hoodTitle").waitFor();
    assert.match((await p.locator("#hoodTitle").textContent()) ?? "", /^North Beach · \d+ places$/);
    await p.waitForFunction(() => !!window.__tbApp?.ctl);
    await p.waitForFunction(() => window.__tbApp.ctl.map.getLayoutProperty("hoods-line", "visibility") === "visible");
    await p.waitForFunction(() => { const b = window.__tbApp.ctl.bounds(); return b[0] < -122.415 && b[2] > -122.40 && b[2] - b[0] < 0.07; });
    assert.equal(await p.evaluate(() => location.hash), "#city=sf&hood=north-beach");
    await p.locator('[data-act="hoodClear"]').tap();
    await p.waitForFunction(() => location.hash === "");
    await p.locator(".htog").tap();
    await p.locator('#listBody .hrow[data-hood="marina"]').dispatchEvent("click");
    await p.waitForFunction(() => location.hash === "#city=sf&hood=marina");
    await p.locator('[data-act="hoodClear"]').tap();
    assert.equal(await p.locator("#listBody .sfsec").count(), 1, "the SF section stays");
  } finally { await ctx.close(); }
}
