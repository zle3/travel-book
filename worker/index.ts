/**
 * Edge worker (password gate + bot policy). Runs first for every request (assets.run_worker_first).
 * Order: robots.txt -> verified search engines -> bot/scraper block (403) -> password gate -> assets.
 * See worker/README.md. Dependency-free; unit-tested by scripts/test/gate.test.mjs.
 */
import { isBlockedUA, robotsTxt } from "./bots.ts";
import { gatePage } from "./gate-page.ts";
import { defaultCache, dohResolver, verifyCrawler } from "./verify.ts";
import type { CacheLike, Resolver } from "./verify.ts";

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  /** Required while the gate is on; unset = fail closed. */
  SITE_PASSWORD?: string;
  /** HMAC key for session cookies; falls back to a key derived from SITE_PASSWORD. */
  GATE_SECRET?: string;
  /** "1" lets verified search-engine crawlers past the gate. Default (unset or anything else) is OFF: no search indexing. */
  GATE_ALLOW_SEARCH?: string;
  /** "1" turns the password gate off (launch). Bot blocking and robots.txt stay on. */
  GATE_DISABLED?: string;
}

export interface Deps {
  resolve?: Resolver;
  cache?: CacheLike;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
  /** Max IPs tracked by the rate limiter (tests lower it). */
  maxTracked?: number;
}

export type GateMode = "on" | "off" | "misconfigured";

/** Single source of truth: GATE_DISABLED=1 wins; otherwise a password is required (else fail closed). */
export function gateMode(env: Env): GateMode {
  if (env.GATE_DISABLED === "1") return "off";
  return env.SITE_PASSWORD ? "on" : "misconfigured";
}

/** Exact-match paths served without a cookie (icons, manifest, link-preview card). Never a prefix.
 * Keep SITE.previewImage (site-config.ts) in this list. */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/favicon.ico",
  "/favicon.svg",
  "/assets/favicon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/site.webmanifest",
  "/assets/preview-card.png",
]);

const COOKIE = "kotone_gate";
const MAX_AGE = 30 * 24 * 3600;
const FAIL_DELAY_MS = 600;
const RATE_MAX = 10;
const RATE_WINDOW_MS = 10 * 60 * 1000;

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Constant-time string compare: both sides are hashed first so length never short-circuits. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([a, b].map(async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))));
  let diff = 0;
  for (let i = 0; i < ha!.length; i++) diff |= ha![i]! ^ hb![i]!;
  return diff === 0;
}

async function sign(value: string, env: Env): Promise<string> {
  const secret = env.GATE_SECRET || `kotone-gate-v1:${env.SITE_PASSWORD ?? ""}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}

async function hasValidSession(request: Request, env: Env, nowMs: number): Promise<boolean> {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]*)`).exec(request.headers.get("cookie") ?? "");
  if (!m) return false;
  const [exp, mac, extra] = (m[1] ?? "").split(".");
  if (!exp || !mac || extra !== undefined || !/^\d+$/.test(exp)) return false;
  const expected = await sign(exp, env);
  const macOk = await safeEqual(mac, expected);
  return macOk && Number(exp) * 1000 > nowMs;
}

/** Same-origin relative path only; anything else becomes "/". */
export function safeNext(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 2048) return "/";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\u0000-\u001f\u007f]/.test(raw)) return "/";
  if (raw.startsWith("/__gate") || raw.startsWith("/__logout")) return "/";
  return raw;
}

const clearCookie = `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

function gateResponse(origin: string, next: string, status: number, error?: string, extra: Record<string, string> = {}): Response {
  return new Response(gatePage({ next, error, origin }), {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}

// Per-isolate failed-attempt counters (best effort: not shared across isolates/colos).
const attempts = new Map<string, { n: number; reset: number }>();
const MAX_TRACKED = 5000;

/** Drop expired windows first, then the least recently active entries, until under the cap. */
function evictAttempts(t: number, cap: number): void {
  if (attempts.size <= cap) return;
  for (const [k, v] of attempts) if (v.reset <= t) attempts.delete(k);
  for (const k of attempts.keys()) {
    if (attempts.size <= cap) break;
    attempts.delete(k);
  }
}

async function route(request: Request, env: Env, deps: Deps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const url = new URL(request.url);
  const ua = request.headers.get("user-agent") ?? "";
  const ip = request.headers.get("cf-connecting-ip");

  // 1. robots.txt: always public, even to blocked bots (so they can read the disallow).
  if (url.pathname === "/robots.txt" && (request.method === "GET" || request.method === "HEAD")) {
    return new Response(request.method === "HEAD" ? null : robotsTxt(), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
    });
  }

  const mode = gateMode(env);

  // 2. Verified search engine: wins over the bot list. Never by UA alone; fail closed.
  if (mode !== "misconfigured" && env.GATE_ALLOW_SEARCH === "1" && request.method !== "POST") {
    const ok = await verifyCrawler(ip, ua, { resolve: deps.resolve ?? dohResolver, cache: deps.cache ?? defaultCache(now) });
    if (ok) return env.ASSETS.fetch(request);
  }

  // 3. AI crawlers and generic scrapers: 403, before the gate, always.
  if (isBlockedUA(ua)) {
    return new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
  }

  // 3b. Public icons / manifest / preview card: exact paths, GET/HEAD only, no cookie needed.
  if (PUBLIC_PATHS.has(url.pathname) && (request.method === "GET" || request.method === "HEAD")) {
    const res = await env.ASSETS.fetch(request);
    if (!res.ok) return res;
    const headers = new Headers(res.headers);
    headers.set("cache-control", "public, max-age=3600");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }

  // 4. Gate.
  if (url.pathname === "/__logout") {
    return new Response(null, { status: 303, headers: { location: "/", "set-cookie": clearCookie, "cache-control": "no-store" } });
  }

  if (mode === "off") return env.ASSETS.fetch(request);
  if (mode === "misconfigured") {
    return gateResponse(url.origin, "/", 401, "The gate is not configured. Please try again later.");
  }

  if (url.pathname === "/__gate" && request.method === "POST") {
    let form: FormData | null = null;
    try { form = await request.formData(); } catch { /* treated as empty */ }
    const next = safeNext(form?.get("next") ?? url.searchParams.get("next"));
    const key = ip ?? "unknown";
    const t = now();
    const rec = attempts.get(key);
    if (rec && rec.reset > t && rec.n >= RATE_MAX) {
      attempts.delete(key); // blocked attempts count as activity: keep the offender fresh
      attempts.set(key, rec);
      return gateResponse(url.origin, next, 429, "Too many attempts. Try again later.", { "retry-after": String(Math.ceil((rec.reset - t) / 1000)) });
    }
    const given = form?.get("password");
    const ok = await safeEqual(typeof given === "string" ? given : "", env.SITE_PASSWORD!);
    if (!ok) {
      const cur = rec && rec.reset > t ? rec : { n: 0, reset: t + RATE_WINDOW_MS };
      cur.n++;
      attempts.delete(key); // re-insert so the Map's order is least recently active first
      attempts.set(key, cur);
      evictAttempts(t, deps.maxTracked ?? MAX_TRACKED);
      await (deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(FAIL_DELAY_MS);
      return gateResponse(url.origin, next, 401, "Incorrect password.");
    }
    attempts.delete(key);
    const exp = String(Math.floor(t / 1000) + MAX_AGE);
    const cookie = `${COOKIE}=${exp}.${await sign(exp, env)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
    return new Response(null, { status: 303, headers: { location: next, "set-cookie": cookie, "cache-control": "no-store" } });
  }

  if (await hasValidSession(request, env, now())) return env.ASSETS.fetch(request);
  return gateResponse(url.origin, safeNext(url.pathname + url.search), 401);
}

/** Every response the Worker returns (gate, 403, robots.txt, assets) carries the noindex header. */
export const NOINDEX = "noindex, nofollow, noarchive";

export async function handle(request: Request, env: Env, deps: Deps = {}): Promise<Response> {
  const res = await route(request, env, deps);
  const headers = new Headers(res.headers);
  headers.set("x-robots-tag", NOINDEX);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handle(request, env),
};
