// Race: rapid heart taps, sheet open/close and Escape must leave aria state, picks count, storage and focus consistent.
import assert from "node:assert/strict";

export default async function (page, base) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
  await page.goto(base + "/", { waitUntil: "load" });
  const heart = page.locator(".row .heart").first();
  await heart.waitFor();
  for (let i = 0; i < 6; i++) await heart.click({ delay: 0 });
  assert.equal(await heart.getAttribute("aria-pressed"), "false");
  assert.equal(await page.evaluate(() => localStorage.getItem("tb-picks")), "[]");
  await heart.click();
  assert.equal(await heart.getAttribute("aria-pressed"), "true");
  assert.equal((await page.locator("#bar [data-picks-pill]").innerText()).trim(), "1");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tb-picks")).length), 1);

  const opener = page.locator("[data-act=openF]");
  await opener.click();
  const sheet = page.locator("#filtersSheet");
  assert.equal(await sheet.getAttribute("aria-hidden"), "false");
  await page.keyboard.press("Escape");
  assert.equal(await sheet.getAttribute("aria-hidden"), "true");
  assert.equal(await sheet.evaluate((el) => getComputedStyle(el).visibility), "hidden");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-act")), "openF");

  for (let i = 0; i < 5; i++) { await opener.click(); await page.keyboard.press("Escape"); }
  await opener.click();
  assert.equal(await sheet.getAttribute("aria-hidden"), "false");
  assert.equal(await page.locator("#scrim.on").count(), 1);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#scrim.on").count(), 0);

  assert.equal(await page.locator("#shows").evaluate((el) => getComputedStyle(el).visibility), "hidden");
}
