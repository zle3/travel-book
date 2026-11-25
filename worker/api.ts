/** Thin API routes on the same origin: 19hz shows, weather (Open-Meteo), NWS alerts, and proxies to the owner's home backend.
 * No Cloudflare storage products: caching is the Cache API only. Coordinates are rounded to 2 decimals before any upstream call;
 * the visitor's exact location never reaches this Worker (the client rounds first) and is never logged. */
import { REGIONS, parseListing, regionUrl } from "./nineteenhz.ts";
import type { RegionKey } from "./nineteenhz.ts";
import { adaptNwsAlerts, adaptOpenMeteo, defaultUnits, openMeteoUrl, roundCoord } from "../src/lib/weather.ts";
import type { Units } from "../src/lib/weather.ts";

export interface ApiEnv { BACKEND_BASE?: string; PROXY_SECRET?: string }
export interface CacheLike { match(key: Request | string): Promise<Response | undefined>; put(key: Request | string, res: Response): Promise<void> }
export interface ApiDeps { fetch?: typeof fetch; cache?: CacheLike; now?: () => number }

const UA = "little-travel-book (travel.zachle.info)";
export const TTL = { events: 3600, weather: 1200, alerts: 900 } as const;

const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", ...extra } });
const cacheable = (body: unknown, ttl: number): Response => json(body, 200, { "cache-control": `public, max-age=${ttl}, stale-while-revalidate=${ttl * 3}` });

const defaultCache = (): CacheLike | undefined => (typeof caches !== "undefined" ? ((caches as unknown as { default: CacheLike }).default) : undefined);

/** Serve from cache, else build, store, return. A failing upstream falls back to a stale copy when one exists. */
async function cached(key: string, ttl: number, deps: ApiDeps, build: () => Promise<unknown>): Promise<Response> {
  const cache = deps.cache ?? defaultCache();
  const k = new Request(`https://cache.invalid/${key}`);
  const hit = await cache?.match(k);
  const now = (deps.now ?? Date.now)();
  if (hit) {
    const at = Number(hit.headers.get("x-cached-at") ?? 0);
    if (now - at < ttl * 1000) return hit;
  }
  try {
    const res = cacheable(await build(), ttl);
    const stored = new Response(res.clone().body, { status: 200, headers: new Headers(res.headers) });
    stored.headers.set("x-cached-at", String(now));
    await cache?.put(k, stored);
    return res;
  } catch {
    if (hit) return hit;
    return json({ error: "upstream unavailable" }, 502, { "cache-control": "no-store" });
  }
}

async function timed(f: typeof fetch, url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await f(url, { ...init, signal: ctl.signal, headers: { "user-agent": UA, ...(init.headers as Record<string, string> | undefined) } }); } finally { clearTimeout(t); }
}

function coords(p: URLSearchParams): { lat: number; lng: number } | null {
  const lat = Number(p.get("lat")), lng = Number(p.get("lng"));
  if (p.get("lat") === null || p.get("lng") === null || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: roundCoord(lat), lng: roundCoord(lng) };
}

export async function handleApi(request: Request, env: ApiEnv, deps: ApiDeps = {}): Promise<Response> {
  const url = new URL(request.url);
  const f = deps.fetch ?? fetch;
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method not allowed" }, 405, { allow: "GET, HEAD" });
  const path = url.pathname;

  if (path === "/api/events") {
    const region = (url.searchParams.get("region") ?? "bayarea").toLowerCase();
    if (!(region in REGIONS)) return json({ error: "unknown region", regions: Object.keys(REGIONS) }, 400);
    return cached(`events/${region}`, TTL.events, deps, async () => {
      const r = await timed(f, regionUrl(region as RegionKey));
      if (!r.ok) throw new Error(`19hz ${r.status}`);
      const events = parseListing(await r.text());
      if (!events.length) throw new Error("19hz: no rows parsed");
      return { region, source: "19hz.info", fetched: new Date((deps.now ?? Date.now)()).toISOString(), events };
    });
  }

  if (path === "/api/weather") {
    const c = coords(url.searchParams);
    if (!c) return json({ error: "lat and lng required" }, 400);
    const units: Units = url.searchParams.get("units") === "c" ? "c" : url.searchParams.get("units") === "f" ? "f" : defaultUnits(c.lng, c.lat);
    return cached(`weather/${c.lat}/${c.lng}/${units}`, TTL.weather, deps, async () => {
      const r = await timed(f, openMeteoUrl(c.lat, c.lng, units));
      if (!r.ok) throw new Error(`open-meteo ${r.status}`);
      return { source: "Open-Meteo", weather: adaptOpenMeteo(await r.json(), units, new Date((deps.now ?? Date.now)()).toISOString()) };
    });
  }

  if (path === "/api/alerts") {
    const c = coords(url.searchParams);
    if (!c) return json({ error: "lat and lng required" }, 400);
    if (defaultUnits(c.lng, c.lat) !== "f") return cacheable({ source: "NWS", alerts: [] }, TTL.alerts);
    return cached(`alerts/${c.lat}/${c.lng}`, TTL.alerts, deps, async () => {
      const r = await timed(f, `https://api.weather.gov/alerts/active?point=${c.lat},${c.lng}`, { headers: { accept: "application/geo+json" } });
      if (r.status === 404 || r.status === 400) return { source: "NWS", alerts: [] };
      if (!r.ok) throw new Error(`nws ${r.status}`);
      return { source: "NWS", alerts: adaptNwsAlerts(await r.json()) };
    });
  }

  if (path === "/api/health" || path === "/api/live") {
    const base = env.BACKEND_BASE?.replace(/\/$/, "");
    if (!base) return json({ ok: false, error: "backend not configured" }, 503, { "cache-control": "no-store" });
    const target = path === "/api/health" ? `${base}/v1/health` : `${base}/v1/live${url.search}`;
    try {
      const r = await timed(f, target, { headers: env.PROXY_SECRET ? { "x-travel-proxy": env.PROXY_SECRET } : {} }, 2000);
      if (!r.ok) return json({ ok: false, error: "backend error" }, 503, { "cache-control": "no-store" });
      return new Response(r.body, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": path === "/api/health" ? "no-store" : "public, max-age=60, stale-while-revalidate=600", "x-content-type-options": "nosniff" } });
    } catch {
      return json({ ok: false, error: "backend offline" }, 503, { "cache-control": "no-store" });
    }
  }

  return json({ error: "not found" }, 404, { "cache-control": "no-store" });
}

/** Long-lived caching for hashed and bulk static files; everything else keeps the platform default. */
export function assetCacheControl(pathname: string): string | null {
  if (pathname.startsWith("/_astro/") || /^\/(data\/places|search\/areas)\.[0-9a-f]{10}\.json$/.test(pathname)) return "public, max-age=31536000, immutable";
  if (/^\/(michelin|search|glyphs|fonts|basemap|style)\//.test(pathname) || pathname === "/icons.svg") return "public, max-age=86400, stale-while-revalidate=604800";
  return null;
}
