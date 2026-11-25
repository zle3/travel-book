// Race: opening a guide fits the map to the guide and shows only its places as pins; back restores the rest.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/?debug", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    await p.waitForFunction(() => !!window.__tbApp?.ctl);
    await p.locator("#listBody .gcard").first().tap();
    await p.locator("#listBody .ghead").waitFor();
    const n = await p.locator("#listBody .row").count();
    await p.waitForFunction((n) => { const s = window.__tbApp.ctl.map.getSource("places"); const d = s && (s._data || s.serialize?.().data); return d && d.features && d.features.length > 0 && d.features.length <= n + 1; }, n);
    // The map fits the guide: its far points (Sutro Baths west, Mountain Lake north, de Young south) are all on screen.
    await p.waitForFunction(() => { const b = window.__tbApp.ctl.bounds(); return b[0] < -122.5137 && b[2] > -122.4687 && b[1] < 37.7715 && b[3] > 37.7865; });
    await p.locator('#listBody [data-act="guideBack"]').tap();
    await p.waitForFunction(() => { const d = window.__tbApp.ctl.map.getSource("places")._data; return d.features.length > 500; });
  } finally {
    await ctx.close();
  }
}
