// Race: the desktop quick area has labelled groups (Show, Categories), a left-aligned source toggle, no duplicate Shows chip and no orphan chip row.
import assert from "node:assert/strict";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr1 [data-src=mine]").waitFor(); // the app has started
    const labels = await p.locator(".qlab:visible").allTextContents();
    assert.deepEqual(labels, ["Show", "Categories"], "labelled groups");
    assert.equal(await p.locator('#chips [data-tab="shows"]').count(), 0, "no Shows chip in the quick area (Shows is top right)");
    const g = await p.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      const seg = r(document.querySelector("#qr1 .srcseg")), lab = r(document.querySelector("#qlab1")), chips = [...document.querySelectorAll("#qr2 .chip")].map(r);
      const rows = new Map(); for (const c of chips) rows.set(Math.round(c.top), (rows.get(Math.round(c.top)) ?? 0) + 1);
      return { segLeft: seg.left, labLeft: lab.left, counts: [...rows.values()] };
    });
    assert.ok(g.segLeft - g.labLeft < 8, `source toggle is left-aligned with its label (seg ${g.segLeft}, label ${g.labLeft})`);
    assert.ok(g.counts.length === 1 || g.counts.at(-1) >= 2, `no orphan chip on the last row (rows: ${g.counts})`);
  } finally {
    await ctx.close();
  }
}
