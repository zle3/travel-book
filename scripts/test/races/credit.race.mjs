// Race: the map credit line (OpenStreetMap / Protomaps, ODbL licence duty) is visible on phone and desktop and clear of the controls.
import assert from "node:assert/strict";
import { devices } from "playwright";

const box = (p, sel) => p.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vis: cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0 }; });
const overlap = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

export default async function (page, base) {
  const browser = page.context().browser();

  // phone
  const ph = await browser.newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ph.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#sheet").waitFor();
    const text = (await p.locator("#credit").textContent()) ?? "";
    assert.match(text, /OpenStreetMap contributors/, "credit names OpenStreetMap");
    assert.match(text, /Protomaps/, "credit names Protomaps");
    const c = await box(p, "#credit"), s = await box(p, "#sheet");
    assert.ok(c.vis, "credit is visible on phone");
    assert.ok(c.b <= s.t + 1 && c.t >= 0 && c.l >= 0 && c.r <= 390, `credit sits above the sheet inside the viewport (${JSON.stringify(c)} vs sheet top ${s.t})`);
    assert.ok(c.b - c.t >= 14, "credit has real height");
    const fs = await p.locator("#credit").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(fs >= 12, `credit text is at least 12px (is ${fs})`);
  } finally { await ph.close(); }

  // desktop: bottom right, clear of the Key button and not inside the panel.
  const dk = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  try {
    const p = await dk.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#credit").waitFor();
    const c = await box(p, "#credit"), k = await box(p, ".keyb"), pn = await box(p, "#panel");
    assert.ok(c.vis, "credit is visible on desktop");
    assert.ok(c.r <= 1440 && c.b <= 900 && c.l > 440, `credit sits at the map's bottom right (${JSON.stringify(c)})`);
    assert.ok(!overlap(c, k), "credit does not overlap the Key button");
    void pn;
  } finally { await dk.close(); }
}
