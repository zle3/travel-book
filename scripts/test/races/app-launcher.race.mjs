// Race: the 9-dot app launcher opens and closes by touch (phone) and by keyboard (desktop), keeps aria-expanded in step,
// moves focus to the first tile on open and back to the button on close, closes on Escape, and marks the Travel tile as current.
import assert from "node:assert/strict";
import { devices } from "playwright";

const BUTTON = ".app-launcher__button";
const PANEL = "#app-launcher-panel";
const isOpen = (p) => p.locator(PANEL).evaluate((el) => el.matches(":popover-open"));
const expanded = (p) => p.locator(BUTTON).getAttribute("aria-expanded");
// The toggle event that sets aria-expanded fires a task after the popover state changes, so wait for it.
const waitExpanded = (p, value) => p.waitForFunction((v) => document.querySelector(".app-launcher__button")?.getAttribute("aria-expanded") === v, value);
const activeIsFirstTile = (p) => p.evaluate(() => document.activeElement?.classList.contains("app-launcher__tile") && document.activeElement === document.querySelector(".app-launcher__tile"));
const activeIsButton = (p) => p.evaluate(() => document.activeElement?.classList.contains("app-launcher__button"));

async function openPage(browser, device) {
  const ctx = await browser.newContext(device);
  const p = await ctx.newPage();
  await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
  return { ctx, p };
}

export default async function (page, base) {
  const browser = page.context().browser();

  // Phone, touch taps.
  {
    const { ctx, p } = await openPage(browser, { ...devices["iPhone 13"], hasTouch: true, reducedMotion: "reduce" });
    try {
      await p.goto(base + "/", { waitUntil: "load" });
      await p.locator(BUTTON).waitFor();
      assert.equal(await expanded(p), "false", "closed launcher reports aria-expanded=false");
      const box = await p.locator(BUTTON).boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44, `launcher button is a 44px tap target (is ${box?.width}x${box?.height})`);

      await p.locator(BUTTON).tap();
      await p.locator(".app-launcher__tile").first().waitFor({ state: "visible" });
      assert.ok(await isOpen(p), "a tap opens the panel");
      await waitExpanded(p, "true");
      assert.equal(await expanded(p), "true", "open launcher reports aria-expanded=true");
      assert.ok(await activeIsFirstTile(p), "focus moves to the first tile on open");

      await p.keyboard.press("Escape");
      assert.ok(!(await isOpen(p)), "Escape closes the panel");
      await waitExpanded(p, "false");
      assert.equal(await expanded(p), "false", "closed again reports aria-expanded=false");
      assert.ok(await activeIsButton(p), "focus returns to the button after Escape");

      await p.locator(BUTTON).tap();
      assert.ok(await isOpen(p), "a second tap opens it again");
      await p.locator(BUTTON).tap();
      assert.ok(!(await isOpen(p)), "tapping the button again closes it");
      await waitExpanded(p, "false");
      assert.equal(await expanded(p), "false", "tap-close reports aria-expanded=false");

      const current = await p.locator(".app-launcher__tile[aria-current='page']").textContent();
      assert.ok(current && current.includes("Travel"), "the Travel tile carries aria-current=page");
      assert.equal(await p.locator(".app-launcher__tile[aria-current='page']").count(), 1, "exactly one tile is current");
    } finally {
      await ctx.close();
    }
  }

  // Desktop, keyboard only.
  {
    const { ctx, p } = await openPage(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    try {
      await p.goto(base + "/", { waitUntil: "load" });
      await p.locator(BUTTON).focus();
      await p.keyboard.press("Enter");
      await p.locator(".app-launcher__tile").first().waitFor({ state: "visible" });
      assert.ok(await isOpen(p), "Enter on the focused button opens the panel");
      await waitExpanded(p, "true");
      assert.equal(await expanded(p), "true", "keyboard open reports aria-expanded=true");
      assert.ok(await activeIsFirstTile(p), "keyboard open moves focus to the first tile");

      await p.keyboard.press("Escape");
      assert.ok(!(await isOpen(p)), "Escape closes the keyboard-opened panel");
      await waitExpanded(p, "false");
      assert.equal(await expanded(p), "false", "keyboard close reports aria-expanded=false");
      assert.ok(await activeIsButton(p), "keyboard close returns focus to the button");

      await p.keyboard.press("Space");
      assert.ok(await isOpen(p), "Space on the focused button also opens the panel");
      await p.keyboard.press("Escape");
      assert.ok(!(await isOpen(p)), "Escape closes it again");
    } finally {
      await ctx.close();
    }
  }
}
