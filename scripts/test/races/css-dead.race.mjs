// Race (node only): dead CSS stays deleted: the no-op .row.own gradient and the off-token toggle-thumb curve.
import assert from "node:assert/strict";
import fs from "node:fs";

export default async function () {
  const css = fs.readFileSync("src/styles/global.css", "utf8");
  assert.ok(!/\.row\.own/.test(css), ".row.own (a transparent-to-transparent gradient) is gone");
  assert.ok(!/cubic-bezier\(\.3,1\.3,\.5,1\)/.test(css), "the toggle thumb uses var(--ease-out), not its own curve");
}
