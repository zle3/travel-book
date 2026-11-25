// Generates the icon set (from docs/brand/travel-logo.svg) and link-preview card with the locally installed Playwright Chromium.
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
const INK = "#3b2832", MUTED = "#7f5a6e", PAPER = "#f6f5fb", LINE = "#e8e4ef", ACCENT = "#e11d48";
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

// Brand mark: the hand-built master at docs/brand/travel-logo.svg (pastel-blue airplane on a mauve tile).
const MASTER = fs.readFileSync(path.join(root, "docs/brand/travel-logo.svg"), "utf8").trim();
const mark = (size) => MASTER.replace("<svg ", `<svg width="${size}" height="${size}" `);
const fontB64 = (w) => fs.readFileSync(path.join(pub, `fonts/figtree-${w}.woff2`)).toString("base64");
const card = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:F;font-weight:700;src:url(data:font/woff2;base64,${fontB64(700)}) format("woff2")}
@font-face{font-family:F;font-weight:500;src:url(data:font/woff2;base64,${fontB64(500)}) format("woff2")}
*{box-sizing:border-box;margin:0}body{width:1200px;height:630px;background:${PAPER};color:${INK};font-family:F,system-ui,sans-serif;display:flex;align-items:center;gap:72px;padding:0 100px;border:1px solid ${LINE}}
h1{font-size:96px;line-height:1.02;letter-spacing:-.02em;font-weight:700}p{margin-top:26px;font-size:36px;font-weight:500;color:${MUTED}}</style>
<body>${mark(300)}<div><h1>${esc(NAME)}</h1><p>${esc(DOMAIN || "Private preview")}</p></div></body>`;

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
  const shot = async (html, w, h, bg = false) => { const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 }); await p.setContent(html); const b = await p.screenshot({ type: "png", omitBackground: bg }); await p.close(); return b; };
  const icon = (n) => shot(`<body style="margin:0;background:transparent">${mark(n)}</body>`, n, n, true);
  fs.writeFileSync(path.join(pub, "favicon.svg"), MASTER + "\n");
  // iOS fills transparent corners itself, but keep the tile opaque-cornered-free like the blog icon.
  const f16 = await icon(16), f32 = await icon(32);
  fs.writeFileSync(path.join(pub, "favicon.ico"), ico([{ size: 16, png: f16 }, { size: 32, png: f32 }]));
  fs.writeFileSync(path.join(pub, "apple-touch-icon.png"), await icon(180));
  fs.writeFileSync(path.join(pub, "icon-192.png"), await icon(192));
  fs.writeFileSync(path.join(pub, "icon-512.png"), await icon(512));
  fs.writeFileSync(path.join(pub, "assets/preview-card.png"), await shot(card, 1200, 630));
} finally { await browser.close(); }
console.log(`build-icons: wrote favicon.svg, favicon.ico, apple-touch-icon.png, icon-192/512.png, assets/preview-card.png for "${NAME}"`);
