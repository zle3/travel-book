// Race: the "Lots here" hint never shows on first load (backend healthy, so it is the only notice that could show);
// it appears only after the visitor pans or zooms.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, places: [], events: [], alerts: [] }) }));
    await p.route("https://api.travel.zachle.info/**", (r) => r.fulfill({ status: 204, body: "" })); // tiles: missing, not failing
    await p.goto(base + "/?debug", { waitUntil: "load" });
    await p.locator("#qr2 .chip").first().waitFor();
    await p.waitForFunction(() => !!window.__tbApp?.ctl);
    const dense = () => p.locator("#dense").evaluate((el) => el.classList.contains("on"));
    await p.waitForTimeout(6500); // longer than the old 6 s settle delay
    assert.equal(await dense(), false, "no dense hint on first load, even after the page settles");
    await p.evaluate(() => { const m = window.__tbApp.ctl.map; m.jumpTo({ zoom: 12.2 }); m.fire("moveend"); });
    await p.waitForTimeout(400);
    assert.equal(await dense(), false, "a programmatic move (fly-to, restore) is not a visitor pan");
    await p.evaluate(() => { const m = window.__tbApp.ctl.map; m.fire("movestart", { originalEvent: new Event("touchmove") }); m.jumpTo({ zoom: 12.4 }); m.fire("moveend"); });
    await p.waitForTimeout(400);
    assert.equal(await dense(), true, "after a visitor pan or zoom the hint shows");
  } finally {
    await ctx.close();
  }
}
