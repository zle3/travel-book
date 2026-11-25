/** Self-contained password page. No site content, no external assets (system fonts only). */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

import { SITE } from "./site-config.ts";
import type { SiteConfig } from "./site-config.ts";

// Icon cache-bust version; keep in step with ICON_VER in src/layouts/Base.astro.
const ICON_VER = "2";

export function gatePage(opts: { next: string; error?: string; origin: string; site?: SiteConfig }): string {
  const site = opts.site ?? SITE;
  const TITLE = site.title, DESC = site.description, IMG_ALT = site.imageAlt;
  const err = opts.error ? `<p class="err" role="alert">${esc(opts.error)}</p>` : "";
  const origin = opts.origin.replace(/\/+$/, "");
  const meta = [
    `<meta name="description" content="${esc(DESC)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(TITLE)}">`,
    `<meta property="og:description" content="${esc(DESC)}">`,
    `<meta property="og:site_name" content="${esc(site.siteName)}">`,
    `<meta property="og:url" content="${esc(origin)}/">`,
    `<meta property="og:image" content="${esc(origin)}${esc(site.previewImage)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:type" content="image/png">`,
    `<meta property="og:image:alt" content="${esc(IMG_ALT)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(TITLE)}">`,
    `<meta name="twitter:description" content="${esc(DESC)}">`,
    `<meta name="twitter:image" content="${esc(origin)}${esc(site.previewImage)}">`,
    `<link rel="icon" href="/favicon.svg?v=${ICON_VER}" type="image/svg+xml">`,
    `<link rel="icon" href="/favicon.ico?v=${ICON_VER}" sizes="32x32">`,
    `<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=${ICON_VER}">`,
    `<link rel="manifest" href="/site.webmanifest?v=${ICON_VER}">`,
    `<meta name="theme-color" content="${esc(site.themeColorLight)}" media="(prefers-color-scheme: light)">`,
    `<meta name="theme-color" content="${esc(site.themeColorDark)}" media="(prefers-color-scheme: dark)">`,
  ].join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(TITLE)}</title>
${meta}
<meta name="color-scheme" content="light dark">
<style>
:root{--bg:#fbfbfd;--surface:#fff;--ink:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7;--accent:#0071e3;--on-accent:#fff;--err:#b00020;--credit-bg:#f8f4f6;--credit-ink:#6c495b;--credit-line:#d9c6d0}
@media (prefers-color-scheme:dark){:root{--bg:#000;--surface:#1c1c1e;--ink:#f5f5f7;--muted:#a1a1a6;--line:#3a3a3c;--accent:#2997ff;--on-accent:#000;--err:#ff6b6b;--credit-bg:#3b2832;--credit-ink:#d9c6d0;--credit-line:#6c495b}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{width:100%;max-width:360px;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:32px 28px}
.brand{display:flex;align-items:center;gap:10px;font:600 22px/1 Georgia,"Times New Roman",serif;margin-bottom:20px}
.credit{margin:-8px 0 16px;padding:8px 12px;background:var(--credit-bg);border:1px solid var(--credit-line);border-radius:12px}
.credit p{margin:0;color:var(--credit-ink);font-size:14px;line-height:1.4}
.credit p+p{margin-top:2px}
p{margin:0 0 16px;color:var(--muted);font-size:15px}
label{display:block;font-size:14px;margin-bottom:6px}
input[type=password]{width:100%;font:inherit;padding:11px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink)}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{margin-top:14px;width:100%;font:inherit;font-weight:600;padding:11px;border:0;border-radius:10px;background:var(--accent);color:var(--on-accent);cursor:pointer}
.err{color:var(--err);margin:12px 0 0}
</style></head><body><main>
<div class="brand"><span>${esc(site.brand)}</span></div>
<div class="credit">${site.credit.map((l) => `<p>${esc(l)}</p>`).join("")}</div>
<p>This site is not public yet. Enter the password to continue.</p>
<form method="post" action="/__gate">
<input type="hidden" name="next" value="${esc(opts.next)}">
<label for="pw">Password</label>
<input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Continue</button>
${err}
</form></main></body></html>`;
}
