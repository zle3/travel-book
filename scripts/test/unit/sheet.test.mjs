import { test } from "node:test";
import assert from "node:assert/strict";
import { FLICK_PX_PER_MS, MIN_VISIBLE_PX, PEEK_PX, classifyDrag, nearestSnap, pickSnap, rubberBand, snapPositions, tapRaises } from "../../../src/lib/client/sheet.ts";

const H = 800, INNER = 844;
const pos = (safe = 0) => snapPositions(H, INNER, safe);

test("snap positions run full < half < peek < min and min leaves only the grabber and bar", () => {
  const p = pos();
  assert.equal(p.full, 0);
  assert.ok(p.full < p.half && p.half < p.peek && p.peek < p.min);
  assert.equal(p.peek, H - PEEK_PX);
  assert.equal(H - p.min, MIN_VISIBLE_PX);
  assert.ok(MIN_VISIBLE_PX >= 56 && MIN_VISIBLE_PX <= 64);
});

test("safe-area bottom is added below the min bar, and only there", () => {
  const p = pos(34);
  assert.equal(H - p.min, MIN_VISIBLE_PX + 34);
  assert.equal(p.peek, pos().peek);
  assert.equal(p.half, pos().half);
});

test("positions never go negative on a tiny sheet", () => {
  const p = snapPositions(20, INNER);
  for (const v of Object.values(p)) assert.ok(v >= 0);
});

test("rubber band gives a third of the overshoot and nothing inside the range", () => {
  assert.equal(rubberBand(50, 0, 600), 50);
  assert.equal(rubberBand(-30, 0, 600), -10);
  assert.equal(rubberBand(630, 0, 600), 610);
});

test("a gesture under 8 px is pending (a tap), vertical beyond 8 px is a drag, horizontal is a scroll", () => {
  assert.equal(classifyDrag(0, 0), "pending");
  assert.equal(classifyDrag(3, 7), "pending");
  assert.equal(classifyDrag(0, 8), "drag");
  assert.equal(classifyDrag(1, -9), "drag");
  assert.equal(classifyDrag(12, 4), "scroll");
  assert.equal(classifyDrag(-20, 19), "scroll");
});

test("nearest snap picks the closest position and breaks ties toward the top", () => {
  const p = pos();
  assert.equal(nearestSnap(p, p.half + 5), "half");
  assert.equal(nearestSnap(p, p.min + 100), "min");
  assert.equal(nearestSnap({ full: 0, half: 10, peek: 20, min: 30 }, 15), "half");
});

test("a slow release goes to the snap nearest the projected position", () => {
  const p = pos();
  assert.equal(pickSnap(p, p.half, 0), "half");
  assert.equal(pickSnap(p, p.half + 150, 0.05), "peek");
  assert.equal(pickSnap(p, p.peek, -0.05), "peek");
});

test("a flick down from half or peek goes to min, a flick up goes to full", () => {
  const p = pos();
  const fast = FLICK_PX_PER_MS + 0.1;
  assert.equal(pickSnap(p, p.half, fast), "min");
  assert.equal(pickSnap(p, p.peek, fast), "min");
  assert.equal(pickSnap(p, p.peek, -fast), "full");
});

test("a tap on the bar at min raises the sheet, a tap anywhere else does not", () => {
  assert.equal(tapRaises("min", "handle"), true);
  assert.equal(tapRaises("half", "handle"), false);
  assert.equal(tapRaises("min", "list"), false);
});
