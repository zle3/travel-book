// Design lint. Enforces the project's design rules (see DESIGN.md) so they can't regress.
// Rules are configured in ops/lint-design.json (all keys optional; defaults below).
//   noInlineStyle          no style="" in pages/layouts except allowed properties (inlineStyleAllow)
//   noThickEdgeStripe      no border-left/top >= 2px (coloured edge stripes)
//   noHardcodedBackground  no #fff/#000/white/black backgrounds in CSS files whose path contains one of backgroundPathIncludes
//   noPtUnits              no `pt` units in screen CSS (print blocks are exempt)
//   noAllCaps              no text-transform: uppercase (OFF by default; opt in per project)
// Usage: node scripts/test/lint-design.mjs [--root <dir>]   (root defaults to the current directory)
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const ri = argv.indexOf("--root");
const root = path.resolve(ri !== -1 ? argv[ri + 1] : process.cwd());

const DEFAULTS = {
  cssDirs: ["src/styles"],
  pageDirs: ["src/pages", "src/layouts", "src/components"],
  inlineStyleAllow: ["width", "height", "visibility"],
  backgroundPathIncludes: ["/features/"],
  rules: { noInlineStyle: true, noThickEdgeStripe: true, noHardcodedBackground: true, noPtUnits: true, noAllCaps: false },
};
let user = {};
const cfgFile = path.join(root, "ops/lint-design.json");
if (fs.existsSync(cfgFile)) {
  try { user = JSON.parse(fs.readFileSync(cfgFile, "utf8")); } catch (e) { console.error(`design lint: bad ${cfgFile}: ${e.message}`); process.exit(2); }
}
const cfg = { ...DEFAULTS, ...user, rules: { ...DEFAULTS.rules, ...(user.rules || {}) } };

const walk = (d) => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])) : []);
const problems = [];
const rel = (f) => path.relative(root, f).split(path.sep).join("/");

for (const dir of cfg.cssDirs) {
  for (const f of walk(path.join(root, dir))) {
    if (!f.endsWith(".css")) continue;
    const lines = fs.readFileSync(f, "utf8").split("\n");
    // Track @media print blocks: print output is always light and uses pt, so those rules don't apply there.
    let printDepth = -1, depth = 0;
    lines.forEach((l, i) => {
      const at = `${rel(f)}:${i + 1}`;
      if (printDepth < 0 && /@media\s+print/.test(l)) printDepth = depth;
      depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
      const inPrint = printDepth >= 0;
      if (inPrint && depth <= printDepth) printDepth = -1;
      if (inPrint) return;
      if (cfg.rules.noAllCaps && /text-transform:\s*uppercase/.test(l)) problems.push(`${at} all-caps label (text-transform: uppercase)`);
      if (cfg.rules.noThickEdgeStripe && /border-(left|top)(-width)?:\s*([2-9]|\d{2,})px/.test(l)) problems.push(`${at} thick edge stripe`);
      if (cfg.rules.noHardcodedBackground && cfg.backgroundPathIncludes.some((p) => ("/" + rel(f)).includes(p)) && /background(-color)?:\s*(#fff\b|#ffffff|white\b|#000\b|black\b)/i.test(l)) problems.push(`${at} hardcoded background colour (use tokens)`);
      if (cfg.rules.noPtUnits && /(^|[^\w-])-?\d*\.?\d+pt\b/.test(l)) problems.push(`${at} pt unit in screen CSS (use rem/px; pt is for print only)`);
    });
  }
}
if (cfg.rules.noInlineStyle) {
  const allow = new RegExp(`^\\s*(${cfg.inlineStyleAllow.join("|")})\\s*:`);
  for (const dir of cfg.pageDirs) {
    for (const f of walk(path.join(root, dir))) {
      if (!f.endsWith(".astro")) continue;
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/\sstyle="([^"]*)"/g)) if (!allow.test(m[1])) problems.push(`${rel(f)} inline style="${m[1]}"`);
    }
  }
}
if (problems.length) { console.error(problems.join("\n")); console.error(`\ndesign lint: ${problems.length} problem(s)`); process.exit(1); }
console.log("design lint: OK");
