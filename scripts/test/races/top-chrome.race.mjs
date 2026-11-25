// Race: the top bar, chips and sheet chrome never zoom the page (touch-action without pinch-zoom); inputs are 16px so iOS does not auto-zoom.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr2 .chip").first().waitFor();
    const ta = (sel) => p.locator(sel).first().evaluate((el) => getComputedStyle(el).touchAction);
    // touch-action intersects down the tree, so the containers hold the rule: no pinch-zoom anywhere in the chrome.
    for (const sel of [".top", ".ctl", "#sheet"]) {
      const v = await ta(sel);
      assert.ok(!v.includes("pinch-zoom") && v !== "auto", `${sel} must not allow pinch zoom (touch-action=${v})`);
    }
    assert.equal(await ta("#grab"), "none", "the grabber is a true drag handle");
    assert.equal(await ta(".shead"), "none", "the header bar is a true drag handle");
    const fontPx = await p.locator("#q").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(fontPx >= 16, `search input must be at least 16px on phone (is ${fontPx}px) so iOS does not zoom on focus`);
  } finally {
    await ctx.close();
  }
}
