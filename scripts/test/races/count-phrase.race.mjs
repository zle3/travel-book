// Race: desktop first load uses one place-count phrase ("... places in this area"), not "2,298 places" first and a different phrase later.
import assert from "node:assert/strict";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    const seen = new Set();
    for (let i = 0; i < 10; i++) { seen.add(((await p.locator("[data-cnt]").textContent()) ?? "").replace(/[\d,]+/, "N")); await p.waitForTimeout(150); }
    for (const t of seen) assert.match(t, /places? in this area$/i, `count phrase is consistent (saw "${t}")`);
  } finally {
    await ctx.close();
  }
}
