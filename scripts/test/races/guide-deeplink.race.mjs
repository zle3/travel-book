// Race: #guide=inner-richmond opens the guide straight away; an unknown guide id is ignored.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/#guide=inner-richmond", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    await p.locator("#listBody .ghead h2").waitFor();
    assert.equal(await p.locator("#listBody .ghead h2").textContent(), "Inner Richmond");
    const q = await p.context().newPage();
    await q.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await q.goto(base + "/#guide=nope", { waitUntil: "load" });
    await q.locator("#qr1 [data-src=mine]").waitFor();
    assert.equal(await q.locator("#listBody .ghead").count(), 0, "unknown guide: normal feed");
  } finally {
    await ctx.close();
  }
}
