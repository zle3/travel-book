// Browser smoke test over every built page: loads without JS errors, no sideways
// scroll on a phone, 44x44 tap targets on a phone, works in light and dark. Serves dist/ with Astro's preview().
// Usage: node scripts/test/smoke.mjs [--dist <dir>]
//   --dist = serve a different built site (default ./dist).
// Redirect pages (meta refresh, e.g. legacy demo paths) are not checked for overflow or console
// errors: the browser leaves them within a moment. Instead the redirect target is asserted.
// Every route check is wrapped, so a failure prints one named line "<view> <route>: <error>".
import { preview } from "astro";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { smallTapTargets } from "./taps.mjs";

const argv = process.argv.slice(2);
const distFlag = argv.indexOf("--dist");
const customDist = distFlag !== -1 ? argv[distFlag + 1] : undefined;
if (distFlag !== -1 && (!customDist || customDist.startsWith("--"))) { console.error("smoke: --dist needs a directory"); process.exit(1); }
const dist = customDist ? path.resolve(customDist) : path.resolve("dist");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const routes = walk(dist)
  .filter((f) => f.endsWith("index.html") && !f.includes(`${path.sep}_astro${path.sep}`))
  .map((f) => "/" + path.relative(dist, path.dirname(f)).split(path.sep).join("/"))
  .map((r) => (r === "/" ? "/" : r + "/"))
  .sort();

// Redirect pages: <meta http-equiv="refresh" content="0;url=TARGET">. Map route -> target pathname.
const redirects = new Map();
const failures = [];
for (const r of routes) {
  const html = fs.readFileSync(path.join(dist, r, "index.html"), "utf8");
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    if (!/http-equiv=["']?refresh/i.test(tag)) continue;
    const url = /content=["'][^"']*url=([^"']+)["']/i.exec(tag)?.[1]?.trim();
    if (!url) continue;
    const target = new URL(url, "http://dist" + r).pathname;
    redirects.set(r, target);
    const file = target.endsWith("/") ? path.join(dist, target, "index.html") : path.join(dist, target);
    if (!fs.existsSync(file) && !fs.existsSync(path.join(dist, target, "index.html"))) failures.push(`static ${r}: redirect target ${target} is missing from dist`);
  }
}

// Use any locally installed Playwright Chromium (avoids re-downloading per worktree).
function findChromium() {
  if (process.env.PW_CHROMIUM) return process.env.PW_CHROMIUM;
  const cache = path.join(os.homedir(), ".cache/ms-playwright");
  if (!fs.existsSync(cache)) return undefined;
  const dirs = fs.readdirSync(cache).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()));
  for (const d of dirs) {
    for (const rel of ["chrome-headless-shell-linux64/chrome-headless-shell", "chrome-linux/headless_shell", "chrome-linux64/chrome", "chrome-linux/chrome"]) {
      const p = path.join(cache, d, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

// Free port: SMOKE_PORT override, else let the OS pick one (bind port 0).
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const PORT = Number(process.env.SMOKE_PORT) || (await freePort());
const base = `http://127.0.0.1:${PORT}`;

// Serve dist/ with Astro's programmatic preview, in this process: no child process or daemon
// (the `astro preview` CLI backgrounds itself when it detects an agent, which leaked servers),
// and no shared lock file. Always torn down: success, failure, exception, signal.
const server = await preview({ root: process.cwd(), logLevel: "silent", server: { port: PORT, host: "127.0.0.1" }, ...(customDist ? { outDir: dist } : {}) }).catch((e) => { console.error(`smoke: could not start preview on port ${PORT}: ${e.message}`); process.exit(1); });
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; try { await Promise.race([server.stop(), new Promise((r) => setTimeout(r, 3000))]); } catch {} };
const die = async (msg) => { console.error(`smoke: ${msg}`); await stop(); process.exit(1); };
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, async () => { await stop(); process.exit(130); });
process.on("uncaughtException", (e) => die(`uncaught exception: ${e?.stack || e}`));
process.on("unhandledRejection", (e) => die(`unhandled rejection: ${e?.stack || e}`));
if (server.port !== undefined && server.port !== PORT) await die(`preview bound port ${server.port}, expected ${PORT}`);

// Wait for OUR server (fail fast if it exits, e.g. port already taken), then prove it serves THIS dist.
const distIndex = fs.readFileSync(path.join(dist, "index.html"));
const titleOf = (b) => /<title[^>]*>([\s\S]*?)<\/title>/i.exec(b.toString())?.[1]?.trim();
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  try { up = (await fetch(base + "/")).ok; } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
if (!up) await die(`server on port ${PORT} never answered`);
const live = Buffer.from(await (await fetch(base + "/")).arrayBuffer());
if (live.length !== distIndex.length || titleOf(live) !== titleOf(distIndex)) await die(`port ${PORT} is serving a different site than ${dist} (title "${titleOf(live)}" vs "${titleOf(distIndex)}", ${live.length} vs ${distIndex.length} bytes); refusing to test it`);

const browser = await chromium.launch({ executablePath: findChromium() });
const views = [
  { name: "desktop/light", viewport: { width: 1280, height: 900 }, colorScheme: "light" },
  { name: "phone/dark", viewport: { width: 390, height: 844 }, colorScheme: "dark" },
];
const pathOf = (page) => new URL(page.url()).pathname;
const withSlash = (p) => (p.endsWith("/") ? p : p + "/");
const notes = [];
// Delayed client-side redirects (JS location.replace after an async check, e.g. a members page -> a sign-in page) destroy the
// page's execution context mid-check. Retry once on the new document; a second destruction fails with a named message.
const DESTROYED = /Execution context was destroyed/;
async function evalSettled(page, fn, arg) {
  try { return await page.evaluate(fn, arg); } catch (e) { if (!DESTROYED.test(String(e?.message))) throw e; }
  await page.waitForLoadState("load").catch(() => {});
  try { return await page.evaluate(fn, arg); } catch (e) {
    if (!DESTROYED.test(String(e?.message))) throw e;
    throw new Error("navigated during checks twice (execution context destroyed on retry): a client-side redirect keeps firing");
  }
}
// After load: bounded network idle, then a quiet window, so a delayed client-side redirect has already happened.
const SETTLE_MS = 600;
async function settle(page) {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
}
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, colorScheme: v.colorScheme, reducedMotion: "reduce" });
  for (const r of routes) {
    const label = `${v.name} ${r}`;
    const expectTarget = redirects.get(r);
    const page = await ctx.newPage();
    try {
      const errs = [];
      page.on("pageerror", (e) => errs.push(e.message));
      page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
      const res = await page.goto(base + r, { waitUntil: "load" });
      const status = res?.status();
      if (status !== 200) failures.push(`${label}: HTTP ${status}`);
      // Redirect pages move on by themselves: wait for the target, then for its load.
      if (expectTarget) await page.waitForURL((u) => u.pathname === expectTarget, { timeout: 10000 }).catch(() => {});
      await settle(page);
      // Settled: a meta redirect must land on its target.
      const at = pathOf(page);
      if (expectTarget && at !== expectTarget) {
        failures.push(`${label}: redirect ended at ${at}, expected ${expectTarget}`);
      } else if (!expectTarget && withSlash(at) !== r) {
        // Client-side redirect: the destination must be a built route, which its own iteration checks
        // (theme, overflow, taps). This route is skipped with a named note instead of a false failure.
        if (routes.includes(withSlash(at))) notes.push(`${label}: client-side redirect to ${at}; checked on its own route`);
        else failures.push(`${label}: client-side redirect ended at ${at}, which is not a built route`);
      } else if (!expectTarget) {
        if (errs.length) failures.push(`${label}: ${errs[0]}`);
        if (v.viewport.width < 500) {
          await page.waitForLoadState("load");
          const over = await evalSettled(page, () => (document.documentElement ? document.documentElement.scrollWidth - window.innerWidth : null));
          if (over === null) failures.push(`${label}: page has no document element`);
          else if (over > 1) failures.push(`${label}: page scrolls sideways by ${over}px`);
        }
        // Invisible hit target: whatever a coarse grid of taps lands on must be visible. A closed menu made
        // with opacity:0 (or kept in the tree with visibility:visible) still eats taps meant for the page below.
        // elementFromPoint ignores visibility:hidden and pointer-events:none, so a correctly closed menu passes.
        const ghost = await evalSettled(page, () => {
          const sel = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "");
          const hiddenBy = (el) => {
            for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
              const cs = getComputedStyle(n);
              if (cs.visibility === "hidden" || cs.opacity === "0") return n;
            }
            return null;
          };
          for (let x = 4; x < window.innerWidth; x += 40) for (let y = 4; y < window.innerHeight; y += 60) {
            const el = document.elementFromPoint(x, y);
            if (!el) continue;
            const bad = hiddenBy(el);
            if (bad) return { selector: sel(el), x, y, cause: sel(bad) };
          }
          return null;
        });
        if (ghost) failures.push(`${label}: invisible tappable ${ghost.selector} (inside ${ghost.cause}) at ${ghost.x},${ghost.y}`);
        // Tap targets on phones: every visible interactive element has a hit box of at least 44x44 CSS px.
        // Exempt: a link inside running text (an inline <a> in a paragraph that has other text around it).
        // The phone menu is opened first so its items are measured too (closed = not visible = skipped).
        if (v.viewport.width < 500) {
          await evalSettled(page, () => { document.querySelector("[data-menu-toggle]")?.click(); document.querySelector("[data-dd-button]")?.click(); });
          await page.waitForTimeout(350);
          const small = await evalSettled(page, smallTapTargets);
          if (small.length) failures.push(`${label}: tap target under 44x44: ${[...new Set(small)].slice(0, 6).join("; ")}`);
        }
      }
    } catch (e) {
      failures.push(`${label}: ${String(e?.message ?? e).split("\n")[0]}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
  await ctx.close();
}
// 404 page must answer 404.
const ctx = await browser.newContext();
const p404 = await ctx.newPage();
try {
  const r404 = await p404.goto(base + "/definitely-not-a-page");
  if (r404?.status() !== 404) failures.push(`/definitely-not-a-page: expected 404, got ${r404?.status()}`);
} catch (e) {
  failures.push(`/definitely-not-a-page: ${String(e?.message ?? e).split("\n")[0]}`);
}
await browser.close();
await stop();
if (failures.length) { console.error(failures.join("\n")); console.error(`\nsmoke: ${failures.length} failure(s) over ${routes.length} routes`); process.exit(1); }
for (const n of [...new Set(notes)]) console.log(`smoke: note: ${n}`);
console.log(`smoke: OK (${routes.length} routes × ${views.length} views)`);
process.exit(0);
