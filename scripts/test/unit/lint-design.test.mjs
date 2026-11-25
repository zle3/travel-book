// Each lint rule is one independent scenario: a throwaway project with exactly one violation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LINT = resolve(dirname(fileURLToPath(import.meta.url)), "../lint-design.mjs");
function lint(files, config) {
  const d = mkdtempSync(join(tmpdir(), "kotone-lint-"));
  for (const [f, body] of Object.entries(files)) { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), body); }
  if (config) { mkdirSync(join(d, "ops")); writeFileSync(join(d, "ops/lint-design.json"), JSON.stringify(config)); }
  const r = spawnSync("node", [LINT, "--root", d], { encoding: "utf8" });
  return { rc: r.status, out: r.stdout + r.stderr };
}

test("clean project passes", () => {
  assert.equal(lint({ "src/styles/a.css": "a { color: var(--ink); }\n", "src/pages/i.astro": '<div style="width: 3%"></div>' }).rc, 0);
});
test("inline style is rejected", () => {
  const r = lint({ "src/pages/i.astro": '<p style="color:red">x</p>' });
  assert.equal(r.rc, 1); assert.match(r.out, /inline style/);
});
test("thick edge stripe is rejected", () => {
  const r = lint({ "src/styles/a.css": ".x { border-left: 4px solid red; }\n" });
  assert.equal(r.rc, 1); assert.match(r.out, /thick edge stripe/);
});
test("hardcoded background in a features css is rejected, elsewhere allowed", () => {
  assert.equal(lint({ "src/styles/features/f.css": ".x { background: #fff; }\n" }).rc, 1);
  assert.equal(lint({ "src/styles/g.css": ".x { background: #fff; }\n" }).rc, 0);
});
test("pt unit is rejected on screen but allowed inside @media print", () => {
  const bad = lint({ "src/styles/a.css": "p { font-size: 12pt; }\n" });
  assert.equal(bad.rc, 1); assert.match(bad.out, /pt unit/);
  assert.equal(lint({ "src/styles/a.css": "@media print {\n  p { font-size: 12pt; }\n}\n" }).rc, 0);
  assert.equal(lint({ "src/styles/a.css": "p { --opt-in: 1; font-family: x; }\n" }).rc, 0);
});
test("all-caps is off by default and opt-in via ops/lint-design.json", () => {
  const css = { "src/styles/a.css": ".l { text-transform: uppercase; }\n" };
  assert.equal(lint(css).rc, 0);
  const r = lint(css, { rules: { noAllCaps: true } });
  assert.equal(r.rc, 1); assert.match(r.out, /all-caps/);
});
test("a rule can be switched off in config", () => {
  assert.equal(lint({ "src/pages/i.astro": '<p style="color:red">x</p>' }, { rules: { noInlineStyle: false } }).rc, 0);
});
