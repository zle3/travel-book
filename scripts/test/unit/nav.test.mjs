import { test } from "node:test";
import assert from "node:assert/strict";
import { initialNav, step } from "../../../src/lib/client/machines/nav.ts";

test("Escape closes the dropdown first, then the phone menu", () => {
  let s = step(step(initialNav(), { type: "TOGGLE_MENU" }), { type: "TOGGLE_DD", id: "a" });
  assert.deepEqual(s, { menu: true, dd: "a" });
  s = step(s, { type: "ESCAPE" });
  assert.deepEqual(s, { menu: true, dd: null });
  s = step(s, { type: "ESCAPE" });
  assert.deepEqual(s, { menu: false, dd: null });
});

test("toggling the same dropdown twice closes it; another id switches", () => {
  let s = step(initialNav(), { type: "TOGGLE_DD", id: "a" });
  assert.equal(step(s, { type: "TOGGLE_DD", id: "b" }).dd, "b");
  assert.equal(step(s, { type: "TOGGLE_DD", id: "a" }).dd, null);
});

test("events that change nothing return the same object", () => {
  const s = initialNav();
  for (const e of [{ type: "CLOSE_DD" }, { type: "ESCAPE" }, { type: "OUTSIDE" }, { type: "NAVIGATE" }, { type: "RESIZE_DESKTOP" }]) assert.equal(step(s, e), s, e.type);
});

test("NAVIGATE and RESIZE_DESKTOP close the menu", () => {
  const open = { menu: true, dd: "a" };
  assert.deepEqual(step(open, { type: "NAVIGATE" }), initialNav());
  assert.deepEqual(step(open, { type: "RESIZE_DESKTOP" }), { menu: false, dd: "a" });
});
