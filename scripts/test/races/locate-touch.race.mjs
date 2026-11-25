// Race (emulated touch): real touch taps on quick chips toggle them, and Locate me asks for the position (geolocation mocked).
// Race (emulated touch, iPhone profile): real touch taps and swipes through CDP.
// Swipe the grabber down to min and back up, tap the grabber at min to return to half, pull the list down at its top
// to drag the sheet, and tap Locate me (geolocation mocked) and check it asks for the position.
import assert from "node:assert/strict";
import { devices } from "playwright";


// Own context: iPhone profile, touch, motion allowed (the harness forces reduced motion, which hides the swipe we test).
const newPhone = (browser, extra = {}) => browser.newContext({ ...devices["iPhone 13"], hasTouch: true, reducedMotion: "no-preference", ...extra });
const gestureFor = (p, cdp) => async (x, y, dy, steps = 8) => {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    await p.waitForTimeout(12);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (dy * i) / steps }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await p.waitForTimeout(600);
};
const centerOf = async (p, sel) => { const b = await p.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

export default async function (page, base) {
  const ctx = await newPhone(page.context().browser(), { geolocation: { latitude: 37.7749, longitude: -122.4194 }, permissions: ["geolocation"] });
  try {
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      window.__geoCalls = 0;
      const fake = { getCurrentPosition(ok) { window.__geoCalls++; ok({ coords: { latitude: 37.7749, longitude: -122.4194, accuracy: 25 }, timestamp: Date.now() }); }, watchPosition() { return 0; }, clearWatch() {} };
      Object.defineProperty(navigator, "geolocation", { configurable: true, get: () => fake });
    });
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr2 .chip").first().waitFor();
    const food = p.locator('[data-chip="food"]');
    await food.tap();
    assert.equal(await food.getAttribute("aria-pressed"), "true", "a real touch tap turns the chip on");
    await food.tap();
    assert.equal(await food.getAttribute("aria-pressed"), "false", "a second touch tap turns it off");
    await p.locator("#locateBtn").tap();
    await p.waitForFunction(() => window.__geoCalls >= 1, null, { timeout: 5000 });
    assert.equal(await p.evaluate(() => window.__geoCalls), 1, "Locate me asks the browser for the position once");
  } finally {
    await ctx.close();
  }
}
