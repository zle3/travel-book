// Example race: rapid menu toggles and Escape must leave aria-expanded, visibility and focus consistent,
// and a closed menu must not be tappable. Copy this shape for each interactive feature (keep it under 30 s).
import assert from "node:assert/strict";

export default async function (page, base) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/", { waitUntil: "load" });
  const toggle = page.locator("[data-menu-toggle]");
  const links = page.locator("#site-nav");
  const expanded = () => toggle.getAttribute("aria-expanded");
  const visible = () => links.evaluate((el) => getComputedStyle(el).visibility);

  assert.equal(await expanded(), "false");
  assert.equal(await visible(), "hidden", "closed menu must be visibility:hidden");

  // Hammer the toggle: an even number of clicks ends closed, with attributes agreeing.
  for (let i = 0; i < 6; i++) await toggle.click({ delay: 0 });
  assert.equal(await expanded(), "false");
  await page.waitForFunction(() => getComputedStyle(document.querySelector("#site-nav")).visibility === "hidden");

  await toggle.click();
  assert.equal(await expanded(), "true");
  assert.equal(await visible(), "visible");
  await page.keyboard.press("Escape");
  assert.equal(await expanded(), "false");
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-menu-toggle")), true, "Escape returns focus to the toggle");

  // Resizing to desktop width closes the phone menu state.
  await toggle.click();
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForFunction(() => document.querySelector("[data-menu-toggle]").getAttribute("aria-expanded") === "false");
}
