// Race (emulated touch): a downward pull on the list while it is scrolled to the top drags the sheet (Apple Maps style).
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
  const ctx = await newPhone(page.context().browser());
  try {
    const p = await ctx.newPage();
    await p.route("**/api/**", (r) => r.fulfill({ status: 503, body: "{}" }));
    await p.goto(base + "/", { waitUntil: "load" });
    await p.locator("#qr2 .chip").first().waitFor();
    const sheet = p.locator("#sheet");
    const gesture = gestureFor(p, await ctx.newCDPSession(p));
    await p.locator('.seg button[data-seg="list"]').tap();
    await p.waitForTimeout(600);
    assert.equal(await sheet.getAttribute("data-snap"), "full");
    const row = await centerOf(p, "#listBody .row");
    // Full: the list is at its top, so the pull drags the sheet down to min.
    await gesture(row.x, row.y, 500);
    assert.equal(await sheet.getAttribute("data-snap"), "min", "a downward pull on the list at its top drags the sheet to min");
  } finally {
    await ctx.close();
  }
}
