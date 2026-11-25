// Race (node only): the stylesheet uses the type, radius and weight tokens, not literals; weight 650 is gone; --fw-regular is 400.
import assert from "node:assert/strict";
import fs from "node:fs";

export default async function () {
  const css = fs.readFileSync("src/styles/global.css", "utf8");
  const body = css.split("\n").filter((l) => !l.startsWith("@font-face")).join("\n");
  assert.deepEqual([...new Set(body.match(/font-size:\s*[\d.]+px/g) ?? [])], [], "no literal px font sizes outside the tokens");
  assert.deepEqual([...new Set((body.match(/border-radius:\s*[^;}]+/g) ?? []).filter((d) => /\d+px/.test(d)))], [], "no literal px radii outside the tokens");
  assert.ok(!/font-weight:\s*650/.test(body), "no weight 650 (the font ships 400/500/600/700)");
  assert.match(css, /--fw-regular:\s*400/, "regular is 400");
}
