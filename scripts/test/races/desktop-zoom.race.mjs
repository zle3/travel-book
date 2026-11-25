// Race: desktop has zoom in/out buttons in the map controls; phone does not (pinch is enough there).
import assert from "node:assert/strict";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    await p.goto(base + "/?debug", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor();
    const zin = p.locator('.ctl [data-act="zoomIn"]'), zout = p.locator('.ctl [data-act="zoomOut"]');
    assert.ok(await zin.isVisible() && await zout.isVisible(), "zoom buttons are visible on desktop");
    await p.waitForFunction(() => !!window.__tbApp?.ctl);
    const z0 = await p.evaluate(() => window.__tbApp.ctl.map.getZoom());
    await zin.click();
    await p.waitForFunction((z) => window.__tbApp.ctl.map.getZoom() > z + 0.5, z0);
    await zout.click();
    await p.waitForFunction((z) => window.__tbApp.ctl.map.getZoom() < z + 0.5, z0);
    const ph = await p.context().browser().newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    try {
      const q = await ph.newPage();
      await q.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
      await q.goto(base + "/", { waitUntil: "load" });
      await q.locator("#qr1 [data-src=mine]").waitFor();
      assert.equal(await q.locator(".ctl .zoomg").isVisible(), false, "no zoom buttons on phone");
    } finally { await ph.close(); }
  } finally {
    await ctx.close();
  }
}
