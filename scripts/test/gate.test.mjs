// Unit tests for worker/index.ts (password gate, bot policy, verified crawlers). No network.
// Run: node scripts/test/gate.test.mjs   (Node >= 22.18 strips TypeScript types natively)
import assert from "node:assert/strict";
import { handle, safeNext } from "../../worker/index.ts";
import { robotsTxt } from "../../worker/bots.ts";
import { SITE as CFG, makeSite } from "../../worker/site-config.ts";
import { gatePage } from "../../worker/gate-page.ts";
const NOINDEX = "noindex, nofollow, noarchive";

const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const SITE = "<html>SECRET SITE CONTENT</html>";
const ASSETS = { fetch: async () => new Response(SITE, { headers: { "content-type": "text/html" } }) };
const env = (o = {}) => ({ ASSETS, SITE_PASSWORD: "hunter2", GATE_SECRET: "s3cret", ...o });

const mem = new Map();
const memCache = {
  async match(r) { const v = mem.get(r.url); return v === undefined ? undefined : new Response(v); },
  async put(r, res) { mem.set(r.url, await res.text()); },
};
const noDns = async () => { throw new Error("dns disabled"); };
const deps = (o = {}) => ({ resolve: noDns, cache: memCache, delay: async () => {}, ...o });

let t = Date.now();
const req = (path = "/", { method = "GET", ua = BROWSER, ip = "203.0.113.9", cookie, form } = {}) =>
  new Request("https://example.test" + path, {
    method,
    headers: { ...(ua ? { "user-agent": ua } : {}), "cf-connecting-ip": ip, ...(cookie ? { cookie } : {}) },
    ...(form ? { body: new URLSearchParams(form), } : {}),
  });
const login = async (pw, extra = {}, e = env(), ip = "203.0.113.9") =>
  handle(req("/__gate", { method: "POST", form: { password: pw, ...extra }, ip }), e, deps({ now: () => t }));
const cookieOf = (res) => res.headers.get("set-cookie").split(";")[0];

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log("ok  " + name); };

await test("no cookie -> 401 gate, no site HTML, no-store", async () => {
  const res = await handle(req("/product/x"), env(), deps());
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-robots-tag"), NOINDEX);
  const body = await res.text();
  assert.ok(body.includes('type="password"') && !body.includes("SECRET SITE CONTENT"));
  assert.ok(body.includes('value="/product/x"'));
});

await test("wrong password -> 401 with error", async () => {
  const res = await login("nope");
  assert.equal(res.status, 401);
  assert.ok((await res.text()).includes("Incorrect password"));
  assert.equal(res.headers.get("set-cookie"), null);
});

await test("right password -> 303 + cookie flags", async () => {
  const res = await login("hunter2", { next: "/product/x" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/product/x");
  const sc = res.headers.get("set-cookie");
  for (const f of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/", "Max-Age=2592000"]) assert.ok(sc.includes(f), f);
  assert.match(sc, /^kotone_gate=\d+\.[0-9a-f]{64};/);
});

await test("valid cookie -> asset served with noindex header", async () => {
  const c = cookieOf(await login("hunter2"));
  const res = await handle(req("/", { cookie: c }), env(), deps({ now: () => t }));
  assert.equal(res.status, 200);
  assert.equal(await res.text(), SITE);
  assert.equal(res.headers.get("x-robots-tag"), NOINDEX);
});

await test("tampered / expired / rotated-secret cookie -> gate", async () => {
  const c = cookieOf(await login("hunter2"));
  const [name, val] = c.split("=");
  const [exp, mac] = val.split(".");
  const bad = [
    `${name}=${exp}.${mac.replace(/.$/, mac.endsWith("0") ? "1" : "0")}`,
    `${name}=${Number(exp) + 999}.${mac}`,
    `${name}=${exp}`,
    `${name}=garbage`,
  ];
  for (const b of bad) assert.equal((await handle(req("/", { cookie: b }), env(), deps({ now: () => t }))).status, 401, b);
  const later = t + 31 * 24 * 3600 * 1000;
  assert.equal((await handle(req("/", { cookie: c }), env(), deps({ now: () => later }))).status, 401, "expired");
  assert.equal((await handle(req("/", { cookie: c }), env({ GATE_SECRET: "other" }), deps({ now: () => t }))).status, 401, "rotated");
});

await test("open redirect attempts -> /", async () => {
  for (const next of ["//evil.com", "https://evil.com", "/\\evil.com", "/a\r\nSet-Cookie: x=1", "evil", "/__gate"]) {
    const res = await login("hunter2", { next });
    assert.equal(res.headers.get("location"), "/", next);
  }
  assert.equal(safeNext("/a/b?c=1#d"), "/a/b?c=1#d");
});

await test("SITE_PASSWORD unset -> gate, never content (even with cookie)", async () => {
  const c = cookieOf(await login("hunter2"));
  const e = env({ SITE_PASSWORD: undefined });
  const res = await handle(req("/", { cookie: c }), e, deps({ now: () => t }));
  assert.equal(res.status, 401);
  assert.ok((await res.text()).includes("not configured"));
  const v = await handle(req("/", { ua: GOOGLEBOT }), e, deps({ resolve: async () => ["x"] }));
  assert.equal(v.status, 401);
  const p = await handle(req("/__gate", { method: "POST", form: { password: "" } }), e, deps());
  assert.equal(p.status, 401);
});

await test("GATE_SECRET absent: derived key works and changes with password", async () => {
  const e = env({ GATE_SECRET: undefined });
  const c = cookieOf(await login("hunter2", {}, e));
  assert.equal((await handle(req("/", { cookie: c }), e, deps({ now: () => t }))).status, 200);
  assert.equal((await handle(req("/", { cookie: c }), { ...e, SITE_PASSWORD: "new" }, deps({ now: () => t }))).status, 401);
});

await test("GATE_DISABLED=1 -> content, bots still blocked", async () => {
  const e = env({ SITE_PASSWORD: undefined, GATE_DISABLED: "1" });
  assert.equal((await handle(req("/"), e, deps())).status, 200);
  assert.equal((await handle(req("/", { ua: "GPTBot/1.0" }), e, deps())).status, 403);
});

await test("GATE_DISABLED=1 with a password still set -> gate OFF (content), bots 403, robots served", async () => {
  const e = env({ GATE_DISABLED: "1" }); // SITE_PASSWORD remains set
  const res = await handle(req("/"), e, deps());
  assert.equal(res.status, 200);
  assert.equal(await res.text(), SITE);
  assert.equal((await handle(req("/", { ua: "ClaudeBot/1.0" }), e, deps())).status, 403);
  assert.equal((await handle(req("/", { ua: "curl/8" }), e, deps())).status, 403);
  const r = await handle(req("/robots.txt", { ua: "GPTBot" }), e, deps());
  assert.equal(await r.text(), robotsTxt());
});

await test("rate-limit eviction keeps a recent offender limited", async () => {
  const d = () => deps({ now: () => t, maxTracked: 3 });
  const post = (ip, pw) => handle(req("/__gate", { method: "POST", form: { password: pw }, ip }), env(), d());
  const offender = "192.0.2.200";
  for (let i = 0; i < 10; i++) await post(offender, "bad");
  assert.equal((await post(offender, "hunter2")).status, 429);
  // idle IPs get evicted, but not everyone is wiped, and an offender that keeps trying stays limited
  for (let i = 0; i < 20; i++) {
    await post(`198.18.0.${i}`, "bad");
    assert.equal((await post(offender, "hunter2")).status, 429, "recent offender stays limited");
  }
  assert.equal((await post("198.18.0.19", "hunter2")).status, 303, "a recent single failure is not limited");
});

await test("AI / scraper / empty UA -> 403 even with valid cookie", async () => {
  const c = cookieOf(await login("hunter2"));
  for (const ua of ["Mozilla/5.0 AppleWebKit; compatible; GPTBot/1.1", "ClaudeBot/1.0", "Claude-User", "PerplexityBot", "curl/8.5.0",
    "python-requests/2.32", "Go-http-client/2.0", "Java/17", "Mozilla/5.0 HeadlessChrome/120", "Scrapy/2.11", ""]) {
    const res = await handle(req("/", { ua, cookie: c }), env(), deps({ now: () => t }));
    assert.equal(res.status, 403, JSON.stringify(ua));
  }
});

await test("robots.txt public, even to blocked bots, disallows everything", async () => {
  const res = await handle(req("/robots.txt", { ua: "GPTBot/1.0" }), env(), deps());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-robots-tag"), NOINDEX);
  const body = await res.text();
  assert.equal(body, robotsTxt());
  assert.match(body, /^User-agent: \*\nDisallow: \/\n/);
  assert.ok(!body.includes("Allow:"), "no Allow lines");
  assert.ok(!/Sitemap:/.test(body), "no Sitemap line");
  for (const tkn of ["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "CCBot", "PerplexityBot", "Bytespider"])
    assert.ok(body.includes(`User-agent: ${tkn}\n`), tkn);
});

await test("noindex header on every response type (gate, 403, robots, asset, misconfigured, 303, spoofed, 429)", async () => {
  const c = cookieOf(await login("hunter2"));
  const cases = [
    await handle(req("/product/x"), env(), deps()),
    await handle(req("/", { ua: "curl/8" }), env(), deps()),
    await handle(req("/robots.txt"), env(), deps()),
    await handle(req("/", { cookie: c }), env(), deps({ now: () => t })),
    await handle(req("/", { cookie: c }), env({ SITE_PASSWORD: undefined }), deps()),
    await handle(req("/__gate", { method: "POST", form: { password: "bad" }, ip: "192.0.2.150" }), env(), deps()),
    await handle(req("/__logout"), env(), deps()),
    await handle(req("/", { ua: GOOGLEBOT, ip: "198.51.100.20" }), env(), deps()),
    await handle(req("/", { cookie: c }), env({ GATE_DISABLED: "1" }), deps()),
  ];
  for (const res of cases) assert.equal(res.headers.get("x-robots-tag"), NOINDEX, String(res.status));
  const ip = "192.0.2.151";
  for (let i = 0; i < 10; i++) await login("bad", {}, env(), ip);
  assert.equal((await login("bad", {}, env(), ip)).headers.get("x-robots-tag"), NOINDEX, "429");
});

await test("GATE_ALLOW_SEARCH=0: verified Googlebot gets the gate, not content", async () => {
  const resolve = async (name, type) => (type === "PTR" ? ["crawl-66-249-66-1.googlebot.com."] : ["66.249.66.1"]);
  const res = await handle(req("/", { ua: GOOGLEBOT, ip: "66.249.66.1" }), env({ GATE_ALLOW_SEARCH: "0" }), deps({ resolve }));
  assert.equal(res.status, 401);
  assert.ok(!(await res.text()).includes("SECRET"));
});

await test("GATE_ALLOW_SEARCH=1 (code path kept, off by default): verified Googlebot -> content", async () => {
  const resolve = async (name, type) => (type === "PTR" ? ["crawl-66-249-66-1.googlebot.com."] : ["66.249.66.1"]);
  const res = await handle(req("/", { ua: GOOGLEBOT, ip: "66.249.66.1" }), env({ GATE_ALLOW_SEARCH: "1" }), deps({ resolve }));
  assert.equal(res.status, 200);
});

await test("robots.txt is the same on the custom domain", async () => {
  const req2 = new Request("https://preview.example.test/robots.txt", { headers: { "user-agent": "GPTBot/1.0" } });
  const body = await (await handle(req2, env(), deps())).text();
  assert.equal(body, robotsTxt());
  assert.ok(!/Sitemap:/.test(body));
});

await test("public/robots.txt matches what the worker serves", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const f = new URL("../../public/robots.txt", import.meta.url);
  if (existsSync(f)) assert.equal(readFileSync(f, "utf8"), robotsTxt());
});

await test("gate page shows the configured credit and title", async () => {
  const html = await (await handle(req("/"), env(), deps())).text();
  assert.ok(html.includes(`<title>${CFG.title}</title>`));
  for (const line of CFG.credit) assert.ok(html.includes(`<p>${line}</p>`), line);
  assert.ok(html.includes(CFG.brand));
  assert.ok(html.includes('<meta name="robots" content="noindex, nofollow">'));
});

await test("spoofed Googlebot from non-Google IP -> gate, not content", async () => {
  const resolve = async (name, type) => {
    if (type === "PTR") return ["evil.example.com."];
    throw new Error("unexpected " + name);
  };
  const res = await handle(req("/", { ua: GOOGLEBOT, ip: "198.51.100.7" }), env(), deps({ resolve }));
  assert.equal(res.status, 401);
  assert.ok(!(await res.text()).includes("SECRET"));
});

await test("spoofed Googlebot with fake PTR (forward mismatch) -> gate", async () => {
  const resolve = async (name, type) => (type === "PTR" ? ["crawl-1.googlebot.com."] : ["66.249.66.1"]);
  const res = await handle(req("/", { ua: GOOGLEBOT, ip: "198.51.100.8" }), env(), deps({ resolve }));
  assert.equal(res.status, 401);
});

await test("DNS error fails closed", async () => {
  const res = await handle(req("/", { ua: GOOGLEBOT, ip: "198.51.100.9" }), env(), deps());
  assert.equal(res.status, 401);
});

await test("verified Googlebot (v4 and v6) -> content; result cached", async () => {
  let calls = 0;
  const resolve = async (name, type) => {
    calls++;
    if (type === "PTR") {
      assert.equal(name, "1.66.249.66.in-addr.arpa");
      return ["crawl-66-249-66-1.googlebot.com."];
    }
    assert.equal(type, "A");
    return ["66.249.66.1"];
  };
  const r1 = await handle(req("/", { ua: GOOGLEBOT, ip: "66.249.66.1" }), env({ GATE_ALLOW_SEARCH: "1" }), deps({ resolve }));
  assert.equal(r1.status, 200);
  const c = calls;
  await handle(req("/", { ua: GOOGLEBOT, ip: "66.249.66.1" }), env({ GATE_ALLOW_SEARCH: "1" }), deps({ resolve: noDns }));
  assert.equal(calls, c);

  const resolve6 = async (name, type) => {
    if (type === "PTR") {
      assert.equal(name, "1." + "0.".repeat(27) + "4.0.6.2.ip6.arpa");
      return ["crawl-v6.googlebot.com."];
    }
    assert.equal(type, "AAAA");
    return ["2604:0:0:0:0:0:0:1"];
  };
  const r2 = await handle(req("/", { ua: GOOGLEBOT, ip: "2604::1" }), env({ GATE_ALLOW_SEARCH: "1" }), deps({ resolve: resolve6, cache: { match: async () => undefined, put: async () => {} } }));
  assert.equal(r2.status, 200);
});

await test("verified Bingbot -> content; GATE_ALLOW_SEARCH=0 -> gate", async () => {
  const resolve = async (name, type) => (type === "PTR" ? ["msnbot-1-2-3-4.search.msn.com."] : ["40.77.167.1"]);
  const ua = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";
  assert.equal((await handle(req("/", { ua, ip: "40.77.167.1" }), env({ GATE_ALLOW_SEARCH: "1" }), deps({ resolve }))).status, 200);
  mem.clear();
  assert.equal((await handle(req("/", { ua, ip: "40.77.167.1" }), env({ GATE_ALLOW_SEARCH: "0" }), deps({ resolve }))).status, 401);
});

await test("rate limit: 10 failures then 429, even for the right password", async () => {
  const ip = "192.0.2.77";
  for (let i = 0; i < 10; i++) assert.equal((await login("bad", {}, env(), ip)).status, 401);
  const blocked = await login("hunter2", {}, env(), ip);
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get("retry-after"));
  t += 11 * 60 * 1000;
  assert.equal((await login("hunter2", {}, env(), ip)).status, 303);
});

await test("failed login is delayed ~600ms", async () => {
  let waited = 0;
  await handle(req("/__gate", { method: "POST", form: { password: "x" }, ip: "192.0.2.5" }), env(), deps({ delay: async (ms) => { waited = ms; } }));
  assert.equal(waited, 600);
});

await test("logout clears cookie", async () => {
  const res = await handle(req("/__logout"), env(), deps());
  assert.equal(res.status, 303);
  assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
});

const PUBLIC = ["/favicon.ico", "/favicon.svg", "/assets/favicon.svg", "/apple-touch-icon.png", "/icon-192.png", "/icon-512.png", "/site.webmanifest", "/assets/preview-card.png"];
const PREVIEW_BOTS = [
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Facebot", "Twitterbot/1.0",
  "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
  "WhatsApp/2.23.20.0", "TelegramBot (like TwitterBot)", "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
];

await test("public allow-list: exact paths served without cookie, cache + noindex headers", async () => {
  for (const p of PUBLIC) {
    const res = await handle(req(p), env(), deps());
    assert.equal(res.status, 200, p);
    assert.equal(await res.text(), SITE, p);
    assert.equal(res.headers.get("cache-control"), "public, max-age=3600", p);
    assert.equal(res.headers.get("x-robots-tag"), NOINDEX, p);
    assert.equal((await handle(req(p, { method: "HEAD" }), env(), deps())).status, 200, p);
  }
});

await test("public allow-list: 404 from ASSETS passes through uncached; POST stays gated", async () => {
  const e404 = env({ ASSETS: { fetch: async () => new Response("nf", { status: 404 }) } });
  const res = await handle(req("/favicon.ico"), e404, deps());
  assert.equal(res.status, 404);
  assert.notEqual(res.headers.get("cache-control"), "public, max-age=3600");
  assert.equal((await handle(req("/favicon.ico", { method: "POST" }), env(), deps())).status, 401);
});

await test("allow-list is exact-match: look-alikes and everything else stay gated", async () => {
  for (const p of ["/favicon.ico.html", "/favicon.ico/", "/assets/preview-card.png/../og-image.png", "/assets/preview-card.png/x",
    "/assets/og-image.png", "/demos/", "/issues/2026-11-13/", "/assets/fonts/x.woff2", "/icon-192.png.bak", "/site.webmanifest/", "/"]) {
    const res = await handle(req(p), env(), deps());
    assert.equal(res.status, 401, p);
    assert.ok(!(await res.text()).includes("SECRET SITE CONTENT"), p);
  }
});

await test("link-preview bots get the gate page (401), not 403; blocked scrapers still 403", async () => {
  for (const ua of PREVIEW_BOTS) {
    const res = await handle(req("/", { ua }), env(), deps());
    assert.equal(res.status, 401, ua);
    assert.ok((await res.text()).includes('property="og:title"'), ua);
  }
  assert.equal((await handle(req("/", { ua: "GPTBot/1.0" }), env(), deps())).status, 403);
  assert.equal((await handle(req("/favicon.ico", { ua: "GPTBot/1.0" }), env(), deps())).status, 403);
});

const metaFragments = (S, O) => [
  `<title>${S.title}</title>`, `<meta name="description" content="${S.description}">`, '<meta name="robots" content="noindex, nofollow">',
  '<meta property="og:type" content="website">', `<meta property="og:title" content="${S.title}">`, `<meta property="og:description" content="${S.description}">`,
  `<meta property="og:site_name" content="${S.siteName}">`, `<meta property="og:url" content="${O}/">`,
  `<meta property="og:image" content="${O}${S.previewImage}">`, '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">', '<meta property="og:image:type" content="image/png">',
  `<meta property="og:image:alt" content="${S.imageAlt}">`, '<meta name="twitter:card" content="summary_large_image">',
  `<meta name="twitter:title" content="${S.title}">`, `<meta name="twitter:description" content="${S.description}">`,
  `<meta name="twitter:image" content="${O}${S.previewImage}">`,
  '<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml">', '<link rel="icon" href="/favicon.ico?v=2" sizes="32x32">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2">', '<link rel="manifest" href="/site.webmanifest?v=2">',
  `<meta name="theme-color" content="${S.themeColorLight}" media="(prefers-color-scheme: light)">`,
  `<meta name="theme-color" content="${S.themeColorDark}" media="(prefers-color-scheme: dark)">`,
  ...S.credit,
];

await test("gate page carries description, og, twitter, icons, theme-color from the site config", async () => {
  const body = await (await handle(req("/demos/x"), env(), deps())).text();
  for (const frag of metaFragments(CFG, "https://example.test")) assert.ok(body.includes(frag), frag);
});

await test("gate page icon links carry the ?v= cache-bust query", async () => {
  const body = await (await handle(req("/demos/x"), env(), deps())).text();
  for (const p of ["/favicon.svg", "/favicon.ico", "/apple-touch-icon.png", "/site.webmanifest"]) {
    assert.ok(new RegExp(`href="${p.replace(/\./g, "\\.")}\\?v=\\d+"`).test(body), p);
  }
});

await test("the public allow-list matches icon paths with a query string (pathname match)", async () => {
  const res = await handle(req("/favicon.svg?v=2"), env(), deps());
  assert.notEqual(res.status, 401);
});

await test("the preview image is on the public allow-list", () => {
  assert.ok(PUBLIC.includes(CFG.previewImage), CFG.previewImage);
});

await test("rebuild mode wording comes from the config, not from the worker code", () => {
  const v = { name: "Acme", source: "acme.example", owner: "Studio" };
  const S = makeSite("rebuild", v);
  assert.match(S.title, /^Concept redesign of acme\.example, by Studio$/);
  assert.ok(S.credit.some((l) => /not affiliated with Acme/.test(l)));
  const body = gatePage({ next: "/", origin: "https://x.test", site: S });
  for (const frag of metaFragments(S, "https://x.test")) assert.ok(body.includes(frag), frag);
  assert.ok(!makeSite("new", v).credit.join(" ").includes("affiliated"));
});

await test("search bypass is OFF by default: unset GATE_ALLOW_SEARCH does not let verified Googlebot in", async () => {
  const resolve = async (name, type) => (type === "PTR" ? ["crawl-66-249-66-1.googlebot.com."] : ["66.249.66.1"]);
  const res = await handle(req("/", { ua: GOOGLEBOT, ip: "66.249.66.1" }), env(), deps({ resolve, cache: { match: async () => undefined, put: async () => {} } }));
  assert.equal(res.status, 401);
});

console.log(`\n${n} gate tests passed`);
