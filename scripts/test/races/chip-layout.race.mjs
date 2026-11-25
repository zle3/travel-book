// Race: toggling a source chip ("My lists") must never move any tile in the quick-filter rows.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor();
    const boxes = () => p.evaluate(() => [...document.querySelectorAll("#qr1 .chip, #qr1 .srcseg button, #qr1 .srcseg, #qr2 .chip")].map((el) => {
      const r = el.getBoundingClientRect(); return [el.className || el.tagName, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(" ");
    }));
    const before = await boxes();
    await p.locator("#qr1 [data-src=mine]").tap();
    assert.equal(await p.locator("#qr1 [data-src=mine]").getAttribute("aria-pressed"), "false");
    assert.deepEqual(await boxes(), before, "toggling My lists off must not move or resize any tile");
    await p.locator("#qr1 [data-src=mine]").tap();
    assert.deepEqual(await boxes(), before, "toggling My lists back on must not move any tile");
    // Clear-all keeps its slot; it is only visible while something is active.
    assert.equal(await p.locator("#qr1 .chip.clr").isVisible(), false, "clear-all is hidden when nothing is active");
  } finally {
    await ctx.close();
  }
}
