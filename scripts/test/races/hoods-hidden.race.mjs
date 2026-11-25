// Race: outside San Francisco the neighborhoods are hidden and the file is never fetched; flying to SF at zoom 12 shows them by themselves; flying to Oakland hides them again.
import assert from "node:assert/strict";
import { devices } from "playwright";

const vis = (p) => p.evaluate(() => { const m = window.__tbApp.ctl.map; return m.getLayer("hoods-line") ? m.getLayoutProperty("hoods-line", "visibility") : "none"; });
const fly = async (p, lng, lat, zoom) => { await p.evaluate(([x, y, z]) => window.__tbApp.ctl.map.jumpTo({ center: [x, y], zoom: z }), [lng, lat, zoom]); await p.waitForFunction(([x, y]) => Math.abs(window.__tbApp.view.lng - x) < 1e-3 && Math.abs(window.__tbApp.view.lat - y) < 1e-3, [lng, lat]); await p.evaluate(() => window.__tbApp.sfSettled()); };

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    await ctx.addInitScript(() => { try { localStorage.setItem("tb-view", JSON.stringify({ lng: -122.27, lat: 37.80, zoom: 12.4 })); } catch {} });
    const p = await ctx.newPage();
    const asked = [];
    p.on("request", (r) => { if (/\/data\/hoods\//.test(r.url())) asked.push(r.url()); });
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/?debug", { waitUntil: "load" });
    await p.waitForFunction(() => !!window.__tbApp?.ctl);
    await p.evaluate(() => window.__tbApp.sfSettled());
    assert.equal(await p.locator("#listBody .sfsec").count(), 0, "no San Francisco section on Oakland");
    assert.equal(await vis(p), "none", "outline layer hidden outside SF");
    assert.ok(!/DataSF/.test((await p.locator("#credit").textContent()) ?? ""), "no DataSF credit while the layer is off");
    assert.equal(asked.length, 0, `the hoods file is not fetched outside SF (${asked})`);

    await fly(p, -122.4194, 37.7749, 12);
    await p.waitForFunction(() => window.__tbApp.ctl.map.getLayoutProperty("hoods-line", "visibility") === "visible");
    await p.locator("#listBody .sfsec").waitFor();
    assert.match((await p.locator("#credit").textContent()) ?? "", /DataSF/, "credit names DataSF while the layer shows");
    assert.equal(asked.length, 1, "fetched once, on first view");

    await fly(p, -122.27, 37.80, 12);
    await p.waitForFunction(() => window.__tbApp.ctl.map.getLayoutProperty("hoods-line", "visibility") === "none");
    await p.locator("#listBody .sfsec").waitFor({ state: "detached" });
    await fly(p, -122.4194, 37.7749, 12);
    await p.locator("#listBody .sfsec").waitFor();
    assert.equal(asked.length, 1, "cached after the first fetch");
    // Zoomed far out over SF: hidden too.
    await fly(p, -122.4194, 37.7749, 9);
    await p.waitForFunction(() => window.__tbApp.ctl.map.getLayoutProperty("hoods-line", "visibility") === "none");
  } finally { await ctx.close(); }
}
