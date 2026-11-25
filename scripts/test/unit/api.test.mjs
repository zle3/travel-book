import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TTL, assetCacheControl, handleApi } from "../../../worker/api.ts";
import { handle } from "../../../worker/index.ts";

const html = fs.readFileSync(new URL("../fixtures/19hz-sample.html", import.meta.url), "utf8");
const memCache = () => { const m = new Map(); return { m, match: async (k) => { const v = m.get(String(k.url ?? k)); return v ? v.clone() : undefined; }, put: async (k, r) => { m.set(String(k.url ?? k), r.clone()); } }; };
const om = { timezone: "UTC", current: { time: "2026-11-24T15:30", temperature_2m: 50, weather_code: 0, is_day: 1 }, hourly: { time: ["2026-11-24T16:00"], temperature_2m: [49], weather_code: [0], precipitation_probability: [0] }, daily: { time: ["2026-11-24"], weather_code: [0], temperature_2m_max: [52], temperature_2m_min: [40], precipitation_probability_max: [0], sunrise: ["2026-11-24T07:00"], sunset: ["2026-11-24T17:00"] } };
const req = (p, init) => new Request(`https://travel.zachle.info${p}`, init);

test("events: fetches 19hz once, parses, and serves the next hour from cache", async () => {
  let calls = 0; const cache = memCache(); let t = 1000;
  const deps = { cache, now: () => t, fetch: async (u) => { calls++; assert.match(String(u), /eventlisting_Seattle\.php$/); return new Response(html); } };
  const r1 = await handleApi(req("/api/events?region=seattle"), {}, deps);
  const j = await r1.json();
  assert.equal(r1.status, 200); assert.equal(j.events.length, 6); assert.equal(j.source, "19hz.info");
  assert.match(r1.headers.get("cache-control"), new RegExp(`max-age=${TTL.events}`));
  t += 30 * 60 * 1000; await handleApi(req("/api/events?region=seattle"), {}, deps);
  assert.equal(calls, 1, "within the hour: cache");
  t += 40 * 60 * 1000; await handleApi(req("/api/events?region=seattle"), {}, deps);
  assert.equal(calls, 2, "after the hour: refetch");
});
test("events: unknown region is a 400; upstream failure falls back to the stale copy, else 502", async () => {
  assert.equal((await handleApi(req("/api/events?region=mars"), {}, { cache: memCache() })).status, 400);
  const cache = memCache(); let t = 0; let fail = false;
  const deps = { cache, now: () => t, fetch: async () => { if (fail) throw new Error("down"); return new Response(html); } };
  await handleApi(req("/api/events"), {}, deps);
  fail = true; t += 2 * 3600 * 1000;
  const stale = await handleApi(req("/api/events"), {}, deps);
  assert.equal(stale.status, 200);
  assert.equal((await handleApi(req("/api/events?region=losangeles"), {}, deps)).status, 502);
});
test("weather: coordinates are rounded to 2 decimals upstream and in the cache key", async () => {
  const seen = []; const cache = memCache();
  const deps = { cache, fetch: async (u) => { seen.push(String(u)); return new Response(JSON.stringify(om)); } };
  const r = await handleApi(req("/api/weather?lat=37.774929&lng=-122.419416&units=f"), {}, deps);
  assert.equal(r.status, 200);
  const q = new URL(seen[0]).searchParams;
  assert.equal(q.get("latitude"), "37.77"); assert.equal(q.get("longitude"), "-122.42");
  assert.ok(![...cache.m.keys()].some((k) => k.includes("774929") || k.includes("419416")));
  await handleApi(req("/api/weather?lat=37.77123&lng=-122.42111&units=f"), {}, deps);
  assert.equal(seen.length, 1, "nearby points share one cached forecast");
  assert.equal((await r.json()).weather.now.temp, 50);
});
test("weather: bad input is a 400, nothing is fetched", async () => {
  let n = 0; const deps = { cache: memCache(), fetch: async () => { n++; return new Response("{}"); } };
  for (const p of ["/api/weather", "/api/weather?lat=abc&lng=1", "/api/weather?lat=91&lng=0", "/api/alerts?lat=1"]) assert.equal((await handleApi(req(p), {}, deps)).status, 400, p);
  assert.equal(n, 0);
});
test("alerts: US points ask NWS with a generic user agent; elsewhere answers empty without a request", async () => {
  let ua = "", url = "";
  const deps = { cache: memCache(), fetch: async (u, init) => { url = String(u); ua = init.headers["user-agent"]; return new Response(JSON.stringify({ features: [{ properties: { id: "1", event: "Wind Advisory", severity: "Minor", headline: "h" } }] })); } };
  const us = await (await handleApi(req("/api/alerts?lat=37.7749&lng=-122.4194"), {}, deps)).json();
  assert.equal(us.alerts[0].event, "Wind Advisory");
  assert.equal(url, "https://api.weather.gov/alerts/active?point=37.77,-122.42");
  assert.match(ua, /^little-travel-book/); assert.ok(!/@/.test(ua));
  url = ""; const jp = await (await handleApi(req("/api/alerts?lat=35.68&lng=139.69"), {}, deps)).json();
  assert.deepEqual(jp.alerts, []); assert.equal(url, "");
});
test("health and live: not configured or down is a soft 503, configured passes the proxy secret", async () => {
  assert.equal((await handleApi(req("/api/health"), {}, {})).status, 503);
  const down = await handleApi(req("/api/live"), { BACKEND_BASE: "https://home.example" }, { fetch: async () => { throw new Error("tunnel down"); } });
  assert.equal(down.status, 503); assert.equal(down.headers.get("cache-control"), "no-store");
  let hdr = "", target = "";
  const ok = await handleApi(req("/api/live?since=2026-11-01"), { BACKEND_BASE: "https://home.example/", PROXY_SECRET: "s3" }, { fetch: async (u, init) => { target = String(u); hdr = init.headers["x-travel-proxy"]; return new Response('{"places":[],"events":[]}'); } });
  assert.equal(ok.status, 200); assert.equal(hdr, "s3"); assert.equal(target, "https://home.example/v1/live?since=2026-11-01");
});
test("only GET and HEAD; unknown API paths are 404 json", async () => {
  assert.equal((await handleApi(req("/api/events", { method: "POST" }), {}, {})).status, 405);
  assert.equal((await handleApi(req("/api/nope"), {}, {})).status, 404);
});
test("the Worker serves /api/* with the gate off, with the noindex header, and never to bots", async () => {
  const env = { GATE_DISABLED: "1", ASSETS: { fetch: async () => new Response("asset") } };
  const deps = { api: { cache: memCache(), fetch: async () => new Response(JSON.stringify(om)) } };
  const ok = await handle(req("/api/weather?lat=1&lng=2", { headers: { "user-agent": "Mozilla/5.0" } }), env, deps);
  assert.equal(ok.status, 200); assert.match(ok.headers.get("x-robots-tag"), /noindex/);
  const home = await handle(req("/", { headers: { "user-agent": "Mozilla/5.0" } }), env, deps);
  assert.equal(await home.text(), "asset");
  const bot = await handle(req("/api/weather?lat=1&lng=2", { headers: { "user-agent": "GPTBot/1.0" } }), env, deps);
  assert.equal(bot.status, 403);
});
test("bulk data files get long cache headers, the rest keep the platform default", () => {
  assert.match(assetCacheControl("/data/places.dea8e105ac.json"), /immutable/);
  assert.match(assetCacheControl("/_astro/x.js"), /immutable/);
  assert.match(assetCacheControl("/michelin/t/5-12.json"), /max-age=86400/);
  assert.equal(assetCacheControl("/"), null);
  assert.equal(assetCacheControl("/data/places.json"), null);
});
