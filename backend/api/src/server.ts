import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { Db, type Kind, type PlaceRow, type EventRow } from "./db.ts";
import { check } from "./validate.ts";

export interface Config {
  adminToken: string;
  proxySecret: string;       // "" = not set: /v1/live is open (until the Worker has the secret too)
  siteOrigin: string;
  tilesUpstream: string;
  version: string;
  adminRatePerMin: number;
  adminFailPerMin: number;
}

const sha = (s: string): Buffer => createHash("sha256").update(s).digest();
/** Constant-time string compare (both sides hashed to a fixed length first). */
export const safeEqual = (a: string, b: string): boolean => timingSafeEqual(sha(a), sha(b));

/** Fixed-window counter per key. Small and in-memory: one process, one home server. */
class Limiter {
  private hits = new Map<string, { n: number; reset: number }>();
  private max: number;
  private windowMs: number;
  constructor(max: number, windowMs = 60_000) { this.max = max; this.windowMs = windowMs; }
  take(key: string, now = Date.now()): boolean {
    const h = this.hits.get(key);
    if (!h || h.reset <= now) {
      if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      return true;
    }
    return ++h.n <= this.max;
  }
  count(key: string): number { return this.hits.get(key)?.n ?? 0; }
}

const TILE_CACHE = "public, max-age=2592000, immutable";

export function createServer(cfg: Config, db: Db): http.Server {
  const adminRate = new Limiter(cfg.adminRatePerMin);
  const adminFail = new Limiter(cfg.adminFailPerMin);

  const json = (res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void => {
    const data = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex", ...extra });
    res.end(data);
  };

  const clientKey = (req: http.IncomingMessage): string =>
    // Only the header Cloudflare sets (the tunnel overwrites it). x-forwarded-for is client-controlled and never trusted.
    String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "?").trim();

  async function readBody(req: http.IncomingMessage): Promise<unknown> {
    const chunks: Buffer[] = []; let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > 32_768) throw Object.assign(new Error("body too large"), { status: 413 });
      chunks.push(c as Buffer);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"); }
    catch { throw Object.assign(new Error("invalid JSON"), { status: 400 }); }
  }

  const proxyOk = (req: http.IncomingMessage): boolean =>
    !cfg.proxySecret || safeEqual(String(req.headers["x-travel-proxy"] ?? ""), cfg.proxySecret);

  const livePlace = (p: PlaceRow) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng, category: p.category, note: p.note, added: p.added, source: "discord" });
  const liveEvent = (e: EventRow) => ({ id: e.id, title: e.title, venue: e.venue, city: e.city, start: e.start, end: e.end, url: e.url, added: e.added });
  const adminView = (r: PlaceRow | EventRow) => ({ ...r, private: !!r.private });

  async function tiles(req: http.IncomingMessage, res: http.ServerResponse, rest: string): Promise<void> {
    const cors = { "access-control-allow-origin": cfg.siteOrigin, vary: "Origin" };
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...cors, "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "range, if-none-match", "access-control-max-age": "86400" });
      return void res.end();
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method not allowed" }, cors);
    // Only plain path segments: no traversal, no query forwarding.
    if (!/^[A-Za-z0-9._\-/]+$/.test(rest) || rest.includes("..")) return json(res, 400, { error: "bad path" }, cors);
    const up = new URL(cfg.tilesUpstream);
    const preq = http.request({ host: up.hostname, port: up.port || 80, path: "/" + rest, method: req.method, timeout: 8000, headers: { accept: String(req.headers.accept ?? "*/*"), ...(req.headers.range ? { range: String(req.headers.range) } : {}) } }, (pres) => {
      const status = pres.statusCode ?? 502;
      const cacheable = status === 200 || status === 206;
      const isJson = rest.endsWith(".json");
      const headers: Record<string, string> = { ...cors, "cache-control": cacheable ? (isJson ? "public, max-age=3600" : TILE_CACHE) : "public, max-age=300" };
      for (const h of ["content-type", "content-length", "content-encoding", "content-range", "accept-ranges", "etag"]) { const v = pres.headers[h]; if (typeof v === "string") headers[h] = v; }
      res.writeHead(status, headers);
      pres.pipe(res);
    });
    preq.on("timeout", () => preq.destroy(new Error("upstream timeout")));
    preq.on("error", () => { if (!res.headersSent) json(res, 502, { error: "tiles unavailable" }, cors); else res.destroy(); });
    preq.end();
  }

  async function admin(req: http.IncomingMessage, res: http.ServerResponse, parts: string[]): Promise<void> {
    const key = clientKey(req);
    if (adminFail.count(key) >= cfg.adminFailPerMin || !adminRate.take(key)) return json(res, 429, { error: "rate limited" }, { "retry-after": "60" });
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""));
    if (!cfg.adminToken || !m || !safeEqual(m[1]!, cfg.adminToken)) {
      adminFail.take(key);
      return json(res, 401, { error: "unauthorized" }, { "www-authenticate": "Bearer" });
    }
    const [res1, id] = parts;
    const method = req.method ?? "GET";
    // Per Discord message: the bot's undo/private/delete taps.
    if (res1 === "messages" && id) {
      if (method === "GET") { const r = db.byMessage(id); return json(res, 200, { places: r.places.map(adminView), events: r.events.map(adminView) }); }
      if (method === "DELETE") return json(res, 200, { deleted: db.deleteByMessage(id) });
      if (method === "PATCH") {
        const b = (await readBody(req)) as { private?: unknown } | null;
        if (!b || typeof b.private !== "boolean" || Object.keys(b).length !== 1) return json(res, 400, { error: "body must be {private: boolean}" });
        return json(res, 200, { changed: db.setPrivateByMessage(id, b.private) });
      }
      return json(res, 405, { error: "method not allowed" });
    }
    if (res1 !== "places" && res1 !== "events") return json(res, 404, { error: "not found" });
    const kind = res1 as Kind;
    if (!id) {
      if (method === "GET") return json(res, 200, { [kind]: db.list(kind).map(adminView) });
      if (method === "POST") {
        const c = check(kind, await readBody(req), false);
        if (!c.ok) return json(res, 400, { error: c.error });
        const nid = db.insert(kind, c.fields);
        return json(res, 201, adminView(db.get(kind, nid)!));
      }
      return json(res, 405, { error: "method not allowed" });
    }
    if (!/^[0-9a-z]{1,32}$/.test(id)) return json(res, 404, { error: "not found" });
    if (method === "GET") { const r = db.get(kind, id); return r ? json(res, 200, adminView(r)) : json(res, 404, { error: "not found" }); }
    if (method === "PATCH") {
      const c = check(kind, await readBody(req), true);
      if (!c.ok) return json(res, 400, { error: c.error });
      return db.update(kind, id, c.fields) ? json(res, 200, adminView(db.get(kind, id)!)) : json(res, 404, { error: "not found" });
    }
    if (method === "DELETE") return db.remove(kind, id) ? json(res, 200, { deleted: 1 }) : json(res, 404, { error: "not found" });
    return json(res, 405, { error: "method not allowed" });
  }

  return http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://x");
        const path = url.pathname;
        const method = req.method ?? "GET";
        if (path === "/v1/health" && (method === "GET" || method === "HEAD")) {
          return json(res, 200, { ok: true, version: cfg.version, live_updated_at: db.liveUpdatedAt() });
        }
        if (path === "/v1/live" && (method === "GET" || method === "HEAD")) {
          if (!proxyOk(req)) return json(res, 401, { error: "unauthorized" });
          // Private items are filtered in SQL and never reach this code. `since` is accepted but ignored: deletions make deltas unsafe, and the set is small.
          const places = db.list("places", { publicOnly: true }) as PlaceRow[];
          const events = db.list("events", { publicOnly: true }) as EventRow[];
          return json(res, 200, { places: places.map(livePlace), events: events.map(liveEvent), updated_at: db.liveUpdatedAt() || new Date(0).toISOString() }, { "cache-control": "no-store" });
        }
        if (path.startsWith("/v1/tiles/")) return await tiles(req, res, path.slice("/v1/tiles/".length));
        if (path.startsWith("/v1/admin/")) return await admin(req, res, path.slice("/v1/admin/".length).split("/").filter(Boolean));
        return json(res, 404, { error: "not found" });
      } catch (e) {
        const status = (e as { status?: number }).status ?? 500;
        if (status === 500) console.error("api error:", (e as Error).message);
        if (!res.headersSent) json(res, status, { error: status === 500 ? "internal error" : (e as Error).message });
      }
    })();
  });
}
