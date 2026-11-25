// Race harness: runs every scripts/test/races/*.race.mjs against dist/ in a real browser.
// Each race file default-exports `async (page, base) => {}`; a throw or rejection is a failure.
// Usage: node scripts/test/races.mjs [filter] [--dist <dir>]
//   filter = substring of the race file name, e.g. "drill"
//   --dist = serve a different built site (e.g. an older commit's dist) with the CURRENT race files;
//            used to prove the races fail on pre-fix code. Default is ./dist.
// Served in-process with Astro's preview() on a free port, same approach as smoke.mjs; always torn down.
import { preview } from "astro";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const distFlag = argv.indexOf("--dist");
const customDist = distFlag !== -1 ? argv[distFlag + 1] : undefined;
if (distFlag !== -1 && !customDist) { console.error("races: --dist needs a directory"); process.exit(1); }
const dist = customDist ? path.resolve(customDist) : path.resolve("dist");
const racesDir = path.resolve("scripts/test/races");
const filter = argv.filter((a, i) => a !== "--dist" && !(distFlag !== -1 && i === distFlag + 1)).find(Boolean) || "";
// Every race must finish well inside this: use page.clock for timers, never real sleeps. A race near the limit flakes under load.
const RACE_TIMEOUT_MS = 30000;

const raceFiles = (fs.existsSync(racesDir) ? fs.readdirSync(racesDir) : [])
  .filter((f) => f.endsWith(".race.mjs") && f.includes(filter))
  .sort();
if (raceFiles.length === 0) {
  console.log(filter ? `races: no race files match "${filter}", OK` : "races: no race files yet, OK");
  process.exit(0);
}
if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("races: dist/index.html missing; run `npx astro build` first");
  process.exit(1);
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

// Free port: RACES_PORT override, else let the OS pick one (bind port 0).
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.once("error", rej); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const PORT = Number(process.env.RACES_PORT) || (await freePort());
const base = `http://127.0.0.1:${PORT}`;

const server = await preview({ root: process.cwd(), logLevel: "silent", server: { port: PORT, host: "127.0.0.1" }, ...(customDist ? { outDir: dist } : {}) }).catch((e) => {
  console.error(`races: could not start preview on port ${PORT}: ${e.message}`);
  process.exit(1);
});
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; try { await Promise.race([server.stop(), new Promise((r) => setTimeout(r, 3000))]); } catch {} };
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, async () => { await stop(); process.exit(130); });
process.on("uncaughtException", async (e) => { console.error(`races: uncaught exception: ${e?.stack || e}`); await stop(); process.exit(1); });
process.on("unhandledRejection", async (e) => { console.error(`races: unhandled rejection: ${e?.stack || e}`); await stop(); process.exit(1); });

let browser;
const failures = [];
let passed = 0;
try {
  if (server.port !== undefined && server.port !== PORT) throw new Error(`preview bound port ${server.port}, expected ${PORT}`);

  // Wait for OUR server, then prove it serves THIS dist.
  const distIndex = fs.readFileSync(path.join(dist, "index.html"));
  const titleOf = (b) => /<title[^>]*>([\s\S]*?)<\/title>/i.exec(b.toString())?.[1]?.trim();
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    try { up = (await fetch(base + "/")).ok; } catch {}
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error(`server on port ${PORT} never answered`);
  const live = Buffer.from(await (await fetch(base + "/")).arrayBuffer());
  if (live.length !== distIndex.length || titleOf(live) !== titleOf(distIndex)) throw new Error(`port ${PORT} is serving a different site than ${dist}; refusing to test it`);

  browser = await chromium.launch({ executablePath: findChromium() });
  for (const file of raceFiles) {
    const name = file.replace(/\.race\.mjs$/, "");
    const mod = await import(pathToFileURL(path.join(racesDir, file)).href);
    if (typeof mod.default !== "function") { failures.push(`${name}: default export is not an async (page, base) function`); console.error(`FAIL ${name}`); continue; }
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    let timer;
    try {
      await Promise.race([
        mod.default(page, base),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timed out after ${RACE_TIMEOUT_MS}ms`)), RACE_TIMEOUT_MS); }),
      ]);
      passed++;
      console.log(`PASS ${name}`);
    } catch (e) {
      failures.push(`${name}: ${e?.message || e}`);
      console.error(`FAIL ${name}: ${e?.message || e}`);
    } finally {
      clearTimeout(timer);
      await ctx.close().catch(() => {});
    }
  }
} catch (e) {
  failures.push(`harness: ${e?.message || e}`);
  console.error(`races: ${e?.message || e}`);
} finally {
  await browser?.close().catch(() => {});
  await stop();
}

if (failures.length) {
  console.error(`\nraces: ${failures.length} failure(s), ${passed} passed, of ${raceFiles.length}`);
  process.exit(1);
}
console.log(`races: OK (${passed} race file(s))`);
process.exit(0);
