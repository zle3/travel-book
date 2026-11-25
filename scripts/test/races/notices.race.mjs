// Race: the dense hint and the offline pill never show together, and the dense hint never shows on first load (only after the visitor pans or zooms).
import assert from "node:assert/strict";
import { devices } from "playwright";

const box = (p, sel) => p.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vis: cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0 }; });
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

export default async function (page, base) {
  const browser = page.context().browser();
  const nx = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await nx.newPage();
    await p.clock.install();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/?debug", { waitUntil: "load" });
    await p.locator("#qr2 .chip").first().waitFor();
    const on = () => p.evaluate(() => [...document.querySelectorAll(".offline.on, .dense.on")].map((e) => e.id));
    await p.clock.runFor(1000);
    assert.deepEqual(await on(), [], "no notice on first load");
    await p.clock.runFor(7000);
    assert.ok((await on()).length <= 1, "at most one notice at a time");
    assert.ok(!(await on()).includes("dense"), "the dense hint never shows on first load, even after the page settles");
    // A visitor pan: the map announces a user move, then ends the move.
    await p.waitForFunction(() => !!window.__tbApp?.ctl);
    await p.evaluate(() => { const m = window.__tbApp.ctl.map; m.fire("movestart", { originalEvent: new Event("touchmove") }); m.jumpTo({ zoom: 12 }); m.fire("moveend"); });
    await p.clock.runFor(500);
    const seen = new Set();
    for (let i = 0; i < 25; i++) { const n = await on(); assert.ok(n.length <= 1, `one notice at a time, saw ${n}`); n.forEach((x) => seen.add(x)); await p.clock.runFor(1000); }
    assert.ok(seen.has("offline") && seen.has("dense"), "both notices get their turn, one after the other");
    // While a notice is up, it must be clear of the map controls on the right.
    await p.evaluate(() => { const m = window.__tbApp.ctl.map; m.fire("movestart", { originalEvent: new Event("touchmove") }); m.jumpTo({ zoom: 12.1 }); m.fire("moveend"); });
    await p.clock.runFor(500);
    for (const id of await on()) { const d = await box(p, "#" + id); for (const sel of ["#wxchip", "#locateBtn", ".keyb"]) { const c = await box(p, sel); assert.ok(!c.vis || !overlap(d, c), `#${id} overlaps ${sel}`); } }
  } finally { await nx.close(); }
}
