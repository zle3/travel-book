// Race: the distance sits in its own right-aligned column between the text and the heart, not inside the meta line.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    const row = p.locator("#listBody .row").first();
    const d = row.locator(".dst");
    assert.equal(await d.count(), 1, "each row has a distance column");
    assert.match((await d.textContent()) ?? "", /\d+(\.\d)? ?(mi|ft|km|m)\b/);
    assert.ok(!/\d (mi|ft)\b/.test((await row.locator(".rm").textContent()) ?? ""), "the meta line no longer carries the distance");
    const b = await row.evaluate((el) => { const r = (s) => el.querySelector(s).getBoundingClientRect(); return { dst: r(".dst"), rtx: r(".rtx"), heart: r(".heart") }; });
    assert.ok(b.dst.left >= b.rtx.right - 1 && b.dst.right <= b.heart.left + 4, "distance sits right of the text and left of the heart");
  } finally {
    await ctx.close();
  }
}
