// Race: the Filters sheet says "Other lists: saved by other people." (not the long "not friends' picks" line).
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    await p.locator('[data-act="openF"]').tap();
    const t = (await p.locator("#filtersHost").textContent()) ?? "";
    assert.ok(t.includes("Other lists: saved by other people."), "short copy present");
    assert.ok(!/friends/.test(t), "old copy gone");
  } finally {
    await ctx.close();
  }
}
