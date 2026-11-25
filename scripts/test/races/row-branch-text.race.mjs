// Race: rows no longer spell out "Another location of <name> · <branch>"; branch places keep a subtle labelled mark.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    const rows = await p.locator("#listBody").innerText();
    assert.ok(!/Another location of/i.test(rows), "no 'Another location of' text in the rows");
    // Find a branch place in view: the mark carries the long wording for assistive tech only.
    const marks = await p.locator("#listBody .bd-more").count();
    assert.ok(marks > 0, "branch places in the list keep a subtle mark");
    const label = await p.locator("#listBody .bd-more").first().getAttribute("aria-label");
    assert.match(label ?? "", /^Another location of /, "the mark is labelled for screen readers");
  } finally {
    await ctx.close();
  }
}
