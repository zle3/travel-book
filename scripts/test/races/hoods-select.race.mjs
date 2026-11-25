// Race: the list is there on its own; pick a neighborhood: the layer and alphabetical list appear, the feed filters with the right count, clear works and focus returns.
import assert from "node:assert/strict";
import { devices } from "playwright";

export default async function (page, base) {
  const ctx = await page.context().browser().newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/?debug", { waitUntil: "load" });
    await p.waitForFunction(() => !!window.__tbApp?.ctl);
    await p.locator("#listBody .sfsec .hrow").first().waitFor({ state: "attached" });
    await p.waitForFunction(() => window.__tbApp.ctl.map.getLayer("hoods-line") && window.__tbApp.ctl.map.getLayoutProperty("hoods-line", "visibility") === "visible");
    await p.waitForFunction(() => /DataSF/.test(document.getElementById("credit")?.textContent ?? ""));
    await p.locator(".htog").tap();
    const names = await p.locator("#listBody .hrow .rn").allTextContents();
    assert.equal(names.length, 41, "all 41 neighborhoods are listed");
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), "alphabetical");
    assert.match((await p.locator("#credit").textContent()) ?? "", /DataSF/, "credit names DataSF while the layer shows");
    assert.equal(await p.evaluate(() => window.__tbApp.ctl.map.getLayoutProperty("hoods-line", "visibility")), "visible");
    const row = p.locator('#listBody .hrow[data-hood="mission"]');
    const n = Number((await row.locator(".hc").textContent()).replace(/\D/g, ""));
    assert.ok(n > 20, `Mission has places (${n})`);
    await row.tap();
    await p.locator("#hoodTitle").waitFor();
    assert.equal((await p.locator("#hoodTitle").textContent()).trim(), `Mission · ${n} places`, "header carries name and count");
    assert.equal(await p.evaluate(() => document.activeElement?.id), "hoodTitle", "focus moves into the header");
    assert.equal(await p.locator("#listBody .row").count(), Math.min(n, 40), "the feed lists the neighborhood's places");
    const dst = await p.locator("#listBody .row .dst").allTextContents();
    assert.ok(new Set(dst).size >= 2, `rows show varied distances from the map centre (${[...new Set(dst)]})`);
    assert.equal(await p.evaluate(() => window.__tbApp.ctl.map.getSource("places")._data.features.length), n, "the map shows only those pins");
    assert.match((await p.locator("[data-cnt]").textContent()) ?? "", new RegExp(`^${n} places in Mission`));
    await p.waitForFunction(() => { const b = window.__tbApp.ctl.bounds(); return b[0] < -122.43 && b[2] > -122.40 && b[2] < -122.30; });
    await p.locator('[data-act="hoodClear"]').tap();
    await p.locator("#hoodTitle").waitFor({ state: "detached" });
    assert.equal(await p.locator("#listBody .sfsec > .gh").textContent(), "San Francisco");
    assert.equal(await p.evaluate(() => document.activeElement?.getAttribute("data-fk")), "h:mission", "focus returns to the neighborhood's row");
    await p.waitForFunction(() => window.__tbApp.ctl.map.getSource("places")._data.features.length > 500);
  } finally { await ctx.close(); }
}
