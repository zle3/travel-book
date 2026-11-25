// Race: the "San Francisco" section header is fixed text across small pans, never jumps in and out, and the layer does not flicker on a back-and-forth pan at the city edge.
import assert from "node:assert/strict";
import { devices } from "playwright";

// The map's move has reached the app (the view follows), and the debounce and any load have settled.
const settle = async (p, lng) => { await p.waitForFunction((x) => Math.abs(window.__tbApp.view.lng - x) < 1e-3, lng); await p.waitForFunction(() => window.__tbApp.sfSettled().then(() => true)); };

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/?debug", { waitUntil: "load" });
    await p.waitForFunction(() => !!window.__tbApp?.ctl);
    await p.locator("#listBody .sfsec").waitFor();
    const head = () => p.locator("#listBody .sfsec > .gh").allTextContents();
    assert.deepEqual(await head(), ["San Francisco"]);
    assert.equal(await p.locator("#listBody .sfsec .gcard").count(), 1, "the Inner Richmond guide sits in the section");
    assert.equal(await p.locator("#listBody .sfsec .hrow").count(), 41, "neighborhoods listed with counts");
    assert.equal(await p.locator("#listBody .hexit, #listBody [data-act=sfToggle], #listBody [data-act=sfOff]").count(), 0, "no exit action or chip");
    // Collapsible list.
    assert.equal(await p.locator("#hlist").isVisible(), false);
    await p.locator(".htog").tap();
    assert.equal(await p.locator("#hlist").isVisible(), true);
    await p.locator(".htog").tap();

    const swings = await p.evaluate(() => { window.__sec = []; new MutationObserver(() => window.__sec.push(!!document.querySelector("#listBody .sfsec"))).observe(document.querySelector("#listBody"), { childList: true }); });
    for (const [dx, dy] of [[0.004, 0.003], [-0.006, 0.002], [0.003, -0.005]]) {
      const lng = await p.evaluate(([x, y]) => { const m = window.__tbApp.ctl.map; const c = m.getCenter(); m.jumpTo({ center: [c.lng + x, c.lat + y] }); return c.lng + x; }, [dx, dy]);
      await settle(p, lng);
      assert.deepEqual(await head(), ["San Francisco"], "header text stable after a pan");
    }
    assert.ok((await p.evaluate(() => window.__sec)).every(Boolean), "the section was never absent while panning inside SF");

    // Edge: start off the western shore (hidden), then pan back and forth across it. The layer turns on once and stays on.
    await p.evaluate(() => { window.__tbApp.ctl.map.jumpTo({ center: [-122.545, 37.76], zoom: 12 }); });
    await p.waitForFunction(() => window.__tbApp.ctl.map.getLayoutProperty("hoods-line", "visibility") === "none");
    await p.evaluate(() => {
      const m = window.__tbApp.ctl.map; window.__tog = 0;
      const orig = m.setLayoutProperty.bind(m);
      m.setLayoutProperty = (id, k, v) => { if (id === "hoods-line" && k === "visibility") window.__tog++; return orig(id, k, v); };
    });
    for (const lng of [-122.505, -122.516, -122.506, -122.518, -122.504, -122.515]) {
      await p.evaluate((x) => window.__tbApp.ctl.map.jumpTo({ center: [x, 37.76] }), lng);
      await settle(p, lng);
    }
    const t = await p.evaluate(() => window.__tog);
    assert.equal(t, 1, `visibility toggled ${t} times at the edge (want exactly 1: on, no flicker)`);
  } finally { await ctx.close(); }
}
