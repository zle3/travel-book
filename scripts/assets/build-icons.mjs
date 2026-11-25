// Generates the neutral icon set and link-preview card with the locally installed Playwright Chromium.
//   node scripts/assets/build-icons.mjs [--name "Site Name"] [--domain host]
// Name/domain default to ops/project.conf (KOTONE_PROJECT_NAME / KOTONE_SITE_DOMAIN), else "Your site".
// Writes into public/: favicon.svg, favicon.ico (16 + 32 px PNG frames), apple-touch-icon.png (180),
// icon-192.png, icon-512.png, assets/preview-card.png (1200x630). Colours come from the token values
// in this file (keep them equal to the light theme in src/styles/global.css). System fonts only, so
// glyph shapes vary slightly per machine; re-run after changing the brand, then restyle with the design system.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const pub = path.join(root, "public");
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? undefined : argv[i + 1]; };
const conf = (k) => { try { const m = new RegExp(`^${k}="([^"]*)"`, "m").exec(fs.readFileSync(path.join(root, "ops/project.conf"), "utf8")); return m && !m[1].includes("{{") ? m[1] : undefined; } catch { return undefined; } };
const NAME = flag("--name") ?? conf("KOTONE_PROJECT_NAME") ?? "Your site";
const DOMAIN = flag("--domain") ?? conf("KOTONE_SITE_DOMAIN") ?? "";
const INK = "#1d1d1f", MUTED = "#6e6e73", PAPER = "#fbfbfd", LINE = "#d2d2d7", ACCENT = "#0071e3";
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function findChromium() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const cache = path.join(os.homedir(), ".cache/ms-playwright");
  if (!fs.existsSync(cache)) return undefined;
  const dirs = fs.readdirSync(cache).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()));
  for (const d of dirs) for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/headless_shell", "chrome-linux64/chrome", "chrome-linux/chrome"]) {
    const p = path.join(cache, d, rel); if (fs.existsSync(p)) return p;
  }
}

const mark = (size) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}"><rect width="100" height="100" rx="23" fill="${INK}"/><circle cx="50" cy="50" r="18" fill="${ACCENT}"/></svg>`;
const card = `<!doctype html><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}body{width:1200px;height:630px;background:${PAPER};color:${INK};font-family:system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;justify-content:space-between;padding:72px;border:1px solid ${LINE}}
h1{font-size:88px;line-height:1.05;letter-spacing:-.025em;font-weight:650;max-width:900px}p{font-size:32px;color:${MUTED}}</style>
<body><div>${mark(96)}</div><h1>${esc(NAME)}</h1><p>${esc(DOMAIN || "Private preview")}</p></body>`;

// ICO container with PNG frames (supported by every current browser).
function ico(frames) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(frames.length, 4);
  let off = 6 + 16 * frames.length;
  const dir = frames.map(({ size, png }) => { const e = Buffer.alloc(16); e[0] = size; e[1] = size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(png.length, 8); e.writeUInt32LE(off, 12); off += png.length; return e; });
  return Buffer.concat([head, ...dir, ...frames.map((f) => f.png)]);
}

fs.mkdirSync(path.join(pub, "assets"), { recursive: true });
const browser = await chromium.launch({ executablePath: findChromium() });
try {
  const shot = async (html, w, h) => { const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 }); await p.setContent(html); const b = await p.screenshot({ type: "png", omitBackground: false }); await p.close(); return b; };
  const icon = (n) => shot(`<body style="margin:0;background:transparent">${mark(n)}</body>`, n, n);
  fs.writeFileSync(path.join(pub, "favicon.svg"), mark(100).replace(' width="100" height="100"', ""));
  const f16 = await icon(16), f32 = await icon(32);
  fs.writeFileSync(path.join(pub, "favicon.ico"), ico([{ size: 16, png: f16 }, { size: 32, png: f32 }]));
  fs.writeFileSync(path.join(pub, "apple-touch-icon.png"), await icon(180));
  fs.writeFileSync(path.join(pub, "icon-192.png"), await icon(192));
  fs.writeFileSync(path.join(pub, "icon-512.png"), await icon(512));
  fs.writeFileSync(path.join(pub, "assets/preview-card.png"), await shot(card, 1200, 630));
} finally { await browser.close(); }
console.log(`build-icons: wrote favicon.svg, favicon.ico, apple-touch-icon.png, icon-192/512.png, assets/preview-card.png for "${NAME}"`);
