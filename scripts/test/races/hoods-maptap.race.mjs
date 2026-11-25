// Race: tapping a neighborhood on the map selects it (filters the feed, highlights it); outside San Francisco the same tap does nothing.
import assert from "node:assert/strict";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/?debug", { waitUntil: "load" });
    await p.waitForFunction(() => !!window.__tbApp?.ctl);
    // McLaren Park has no saved pins, so the tap cannot land on one.
    const at = () => p.evaluate(() => { const m = window.__tbApp.ctl.map; m.jumpTo({ center: [-122.42, 37.76], zoom: 12 }); return new Promise((res) => m.once("idle", () => { const pt = m.project([-122.4195, 37.7185]); const r = m.getCanvas().getBoundingClientRect(); res({ x: r.left + pt.x, y: r.top + pt.y }); })); });
    await p.waitForFunction(() => window.__tbApp.ctl.map.getLayoutProperty("hoods-line", "visibility") === "visible");
    const pt = await at();
    await p.mouse.click(pt.x, pt.y);
    await p.locator("#hoodTitle").waitFor();
    assert.match((await p.locator("#hoodTitle").textContent()) ?? "", /^McLaren Park · 0 places$/);
    assert.equal(await p.evaluate(() => window.__tbApp.ctl.map.getFilter("hoods-sel")[2]), "mclaren-park", "outline highlight follows");
  } finally { await ctx.close(); }
}
