import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Db } from "../src/db.ts";
import { createServer, type Config } from "../src/server.ts";

const TOKEN = "t".repeat(40);
const SECRET = "s".repeat(40);
let tilesSrv: http.Server; let api: http.Server; let base = ""; let db: Db;

const cfgFor = (over: Partial<Config> = {}, tilesPort = 0): Config => ({
  adminToken: TOKEN, proxySecret: SECRET, siteOrigin: "https://travel.zachle.info", tilesUpstream: `http://127.0.0.1:${tilesPort}`,
  version: "test", adminRatePerMin: 1000, adminFailPerMin: 1000, ...over,
});
const listen = (s: http.Server): Promise<number> => new Promise((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));
const admin = (path: string, init: RequestInit = {}) => fetch(base + path, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers as Record<string, string>) } });
const live = (headers: Record<string, string> = { "x-travel-proxy": SECRET }) => fetch(base + "/v1/live", { headers });

before(async () => {
  tilesSrv = http.createServer((req, res) => {
    if (req.url === "/basemap-v1/3/1/2.mvt") { res.writeHead(200, { "content-type": "application/x-protobuf" }); return void res.end("tile"); }
    res.writeHead(404); res.end();
  });
  const tp = await listen(tilesSrv);
  db = new Db(":memory:");
  api = createServer(cfgFor({}, tp), db);
  base = `http://127.0.0.1:${await listen(api)}`;
});
after(() => { api.close(); tilesSrv.close(); db.close(); });

test("health is public and small", async () => {
  const r = await fetch(base + "/v1/health");
  assert.equal(r.status, 200);
  const j = await r.json() as Record<string, unknown>;
  assert.equal(j.ok, true);
  assert.equal(j.version, "test");
  assert.ok("live_updated_at" in j);
});

test("live: empty shape matches what adaptLive expects", async () => {
  const j = await (await live()).json() as { places: unknown[]; events: unknown[]; updated_at: string };
  assert.deepEqual(j.places, []);
  assert.deepEqual(j.events, []);
  assert.equal(typeof j.updated_at, "string");
});

test("live: public items have the contract fields, private items never appear", async () => {
  const pub = await (await admin("/v1/admin/places", { method: "POST", body: JSON.stringify({ name: "Blue Bottle", lat: 37.78, lng: -122.41, category: "Tea/Drinks", note: "good", msg_id: "m1" }) })).json() as { id: string };
  const priv = await (await admin("/v1/admin/places", { method: "POST", body: JSON.stringify({ name: "Secret Hotel", lat: 37.7, lng: -122.4, category: "hotels", private: true, msg_id: "m2" }) })).json() as { id: string };
  await admin("/v1/admin/events", { method: "POST", body: JSON.stringify({ title: "Show", venue: "The Fillmore", city: "SF", start: "2026-12-01T20:00", url: "https://example.com/e" }) });
  await admin("/v1/admin/events", { method: "POST", body: JSON.stringify({ title: "Private gig", start: "2026-12-02", private: true }) });
  const j = await (await live()).json() as { places: Array<Record<string, unknown>>; events: Array<Record<string, unknown>> };
  assert.equal(j.places.length, 1);
  assert.deepEqual(Object.keys(j.places[0]!).sort(), ["added", "category", "id", "lat", "lng", "name", "note", "source"]);
  assert.equal(j.places[0]!.id, pub.id);
  assert.equal(j.places[0]!.category, "tea-drinks");
  assert.equal(j.places[0]!.source, "discord");
  assert.equal(j.events.length, 1);
  assert.deepEqual(Object.keys(j.events[0]!).sort(), ["added", "city", "end", "id", "start", "title", "url", "venue"]);
  assert.ok(!JSON.stringify(j).includes("Secret"));
  assert.ok(!JSON.stringify(j).includes(priv.id));
  assert.ok(!JSON.stringify(j).includes("Private gig"));
  // flipping a whole message private hides it, flipping back shows it
  await admin("/v1/admin/messages/m1", { method: "PATCH", body: JSON.stringify({ private: true }) });
  assert.equal(((await (await live()).json()) as { places: unknown[] }).places.length, 0);
  await admin("/v1/admin/messages/m1", { method: "PATCH", body: JSON.stringify({ private: false }) });
  assert.equal(((await (await live()).json()) as { places: unknown[] }).places.length, 1);
});

test("live: proxy secret enforced when set, open when not set", async () => {
  assert.equal((await live({})).status, 401);
  assert.equal((await live({ "x-travel-proxy": "wrong" })).status, 401);
  const open = createServer(cfgFor({ proxySecret: "" }), db);
  const p = await listen(open);
  assert.equal((await fetch(`http://127.0.0.1:${p}/v1/live`)).status, 200);
  open.close();
});

test("admin: auth required, wrong token refused", async () => {
  assert.equal((await fetch(base + "/v1/admin/places")).status, 401);
  assert.equal((await fetch(base + "/v1/admin/places", { headers: { authorization: "Bearer nope" } })).status, 401);
  assert.equal((await fetch(base + "/v1/admin/places", { headers: { authorization: TOKEN } })).status, 401);
  assert.equal((await admin("/v1/admin/places")).status, 200);
});

test("admin: an empty ADMIN_TOKEN never authenticates", async () => {
  const s = createServer(cfgFor({ adminToken: "" }), db);
  const p = await listen(s);
  const r = await fetch(`http://127.0.0.1:${p}/v1/admin/places`, { headers: { authorization: "Bearer " } });
  assert.equal(r.status, 401);
  s.close();
});

test("admin: validation rejects bad rows and unknown fields", async () => {
  const bad = async (kind: string, body: unknown) => (await admin(`/v1/admin/${kind}`, { method: "POST", body: JSON.stringify(body) })).status;
  assert.equal(await bad("places", { name: "x", lat: 999, lng: 0 }), 400);
  assert.equal(await bad("places", { name: "x", lat: 1, lng: 1, category: "Underwater" }), 400);
  assert.equal(await bad("places", { name: "x", lat: 1, lng: 1, evil: 1 }), 400);
  assert.equal(await bad("places", { lat: 1, lng: 1 }), 400);
  assert.equal(await bad("events", { title: "x", start: "tomorrow" }), 400);
  assert.equal(await bad("events", { title: "x", start: "2026-12-01", url: "javascript:alert(1)" }), 400);
});

test("admin: patch, delete, and delete by message", async () => {
  const c = await (await admin("/v1/admin/places", { method: "POST", body: JSON.stringify({ name: "A", lat: 1, lng: 2, msg_id: "mm" }) })).json() as { id: string };
  const p = await (await admin(`/v1/admin/places/${c.id}`, { method: "PATCH", body: JSON.stringify({ note: "n" }) })).json() as { note: string };
  assert.equal(p.note, "n");
  assert.equal((await admin(`/v1/admin/places/${c.id}`, { method: "DELETE" })).status, 200);
  assert.equal((await admin(`/v1/admin/places/${c.id}`, { method: "DELETE" })).status, 404);
  await admin("/v1/admin/places", { method: "POST", body: JSON.stringify({ name: "B", lat: 1, lng: 2, msg_id: "mm2" }) });
  const d = await (await admin("/v1/admin/messages/mm2", { method: "DELETE" })).json() as { deleted: number };
  assert.equal(d.deleted, 1);
});

test("admin: failed-auth attempts are rate limited, then even the right token waits", async () => {
  const s = createServer(cfgFor({ adminFailPerMin: 3 }), new Db(":memory:"));
  const p = await listen(s); const u = `http://127.0.0.1:${p}/v1/admin/places`;
  for (let i = 0; i < 3; i++) assert.equal((await fetch(u, { headers: { authorization: "Bearer bad" } })).status, 401);
  assert.equal((await fetch(u, { headers: { authorization: "Bearer bad" } })).status, 429);
  assert.equal((await fetch(u, { headers: { authorization: `Bearer ${TOKEN}` } })).status, 429);
  s.close();
});

test("admin: overall request rate limit", async () => {
  const s = createServer(cfgFor({ adminRatePerMin: 2 }), new Db(":memory:"));
  const p = await listen(s); const u = `http://127.0.0.1:${p}/v1/admin/places`; const h = { authorization: `Bearer ${TOKEN}` };
  assert.equal((await fetch(u, { headers: h })).status, 200);
  assert.equal((await fetch(u, { headers: h })).status, 200);
  assert.equal((await fetch(u, { headers: h })).status, 429);
  s.close();
});

test("tiles: proxied with CORS limited to the site and long cache", async () => {
  const r = await fetch(base + "/v1/tiles/basemap-v1/3/1/2.mvt", { headers: { origin: "https://travel.zachle.info" } });
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "tile");
  assert.equal(r.headers.get("access-control-allow-origin"), "https://travel.zachle.info");
  assert.equal(r.headers.get("cache-control"), "public, max-age=2592000, immutable");
  assert.equal(r.headers.get("vary"), "Origin");
  const other = await fetch(base + "/v1/tiles/basemap-v1/3/1/2.mvt", { headers: { origin: "https://evil.example" } });
  assert.equal(other.headers.get("access-control-allow-origin"), "https://travel.zachle.info"); // never echoes another origin
});

test("tiles: upstream 404 is not cached immutable; traversal refused; preflight answered", async () => {
  const miss = await fetch(base + "/v1/tiles/basemap-v1/9/9/9.mvt");
  assert.equal(miss.status, 404);
  assert.ok(!miss.headers.get("cache-control")!.includes("immutable"));
  assert.equal((await fetch(base + "/v1/tiles/..%2F..%2Fetc/passwd")).status, 400);
  const pre = await fetch(base + "/v1/tiles/x", { method: "OPTIONS" });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "https://travel.zachle.info");
});

test("tiles: upstream down answers 502 and the API stays up", async () => {
  const s = createServer(cfgFor({}, 1), new Db(":memory:"));
  const p = await listen(s);
  assert.equal((await fetch(`http://127.0.0.1:${p}/v1/tiles/a/1/1/1.mvt`)).status, 502);
  assert.equal((await fetch(`http://127.0.0.1:${p}/v1/health`)).status, 200);
  s.close();
});

test("data survives reopening the database (WAL on disk)", async () => {
  const { mkdtempSync } = await import("node:fs"); const { join } = await import("node:path"); const { tmpdir } = await import("node:os");
  const f = join(mkdtempSync(join(tmpdir(), "tapi-")), "l.sqlite");
  const a = new Db(f);
  assert.equal((a.sql.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode, "wal");
  a.insert("places", { name: "P", lat: 1, lng: 1, category: "other" }); a.close();
  assert.equal(new Db(f).list("places").length, 1);
});

test("admin rate limit keys on cf-connecting-ip only: a spoofed x-forwarded-for cannot dodge it", async () => {
  const s = createServer(cfgFor({ adminFailPerMin: 2 }), new Db(":memory:"));
  const p = await listen(s); const u = `http://127.0.0.1:${p}/v1/admin/places`;
  for (let i = 0; i < 2; i++) assert.equal((await fetch(u, { headers: { authorization: "Bearer bad", "x-forwarded-for": `1.2.3.${i}` } })).status, 401);
  assert.equal((await fetch(u, { headers: { authorization: "Bearer bad", "x-forwarded-for": "9.9.9.9" } })).status, 429);
  // a different client per cf-connecting-ip is counted separately
  assert.equal((await fetch(u, { headers: { authorization: "Bearer bad", "cf-connecting-ip": "5.5.5.5" } })).status, 401);
  s.close();
});
