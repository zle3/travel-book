#!/usr/bin/env node
// Build the search gazetteer (cities, neighbourhoods, ZIP centroids) for the covered metros.
// Sources (open data, downloaded once, never at runtime): GeoNames US.zip (CC BY 4.0), Census 2023 ZCTA gazetteer (public domain).
// Output: src/data/gazetteer.json (committed), consumed by scripts/data/build-data.mjs.
// Usage: node scripts/data/build-gazetteer.mjs [--cache <dir>]   (cache holds the downloads, default: os tmpdir)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { METROS, inBBox } from "../../src/lib/data/metros.ts";

const argv = process.argv.slice(2);
const cache = path.resolve(argv.includes("--cache") ? argv[argv.indexOf("--cache") + 1] : path.join(os.tmpdir(), "travel-gazetteer"));
fs.mkdirSync(cache, { recursive: true });
const root = path.resolve(import.meta.dirname, "../..");

async function get(url, name) {
  const f = path.join(cache, name);
  if (!fs.existsSync(f)) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  return f;
}
function unzipText(zip, member) {
  return execFileSync("unzip", ["-p", zip, member], { maxBuffer: 1 << 29 }).toString("utf8");
}
const r4 = (n) => Math.round(n * 1e4) / 1e4;
const metroIdOf = (lng, lat) => METROS.find((m) => inBBox(lng, lat, m.bbox))?.id;

const out = [];
// GeoNames: tab separated; 0 id, 1 name, 4 lat, 5 lng, 6 class, 7 code, 14 population.
const us = await get("https://download.geonames.org/export/dump/US.zip", "US.zip");
for (const line of unzipText(us, "US.txt").split("\n")) {
  const c = line.split("\t");
  if (c.length < 15 || c[6] !== "P") continue;
  const lat = +c[4], lng = +c[5];
  const m = metroIdOf(lng, lat);
  if (!m) continue;
  const kind = c[7] === "PPLX" ? "hood" : "city";
  out.push({ n: c[1], k: kind, y: r4(lat), x: r4(lng), m, p: +c[14] || 0 });
}
// Census ZCTA centroids: tab separated header GEOID ... INTPTLAT INTPTLONG
const zz = await get("https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip", "zcta.zip");
const zt = unzipText(zz, "2023_Gaz_zcta_national.txt").split("\n");
const head = zt[0].split("\t").map((s) => s.trim());
const iz = head.indexOf("GEOID"), ila = head.indexOf("INTPTLAT"), ilo = head.indexOf("INTPTLONG");
for (const line of zt.slice(1)) {
  const c = line.split("\t");
  if (c.length < 4) continue;
  const lat = +c[ila], lng = +c[ilo];
  const m = metroIdOf(lng, lat);
  if (m) out.push({ n: c[iz].trim(), k: "zip", y: r4(lat), x: r4(lng), m, p: 0 });
}
// Dedup same name+kind within a metro (keep the most populated), drop tiny duplicates.
const seen = new Map();
for (const e of out) {
  const key = `${e.m}|${e.k}|${e.n.toLowerCase()}`;
  const o = seen.get(key);
  if (!o || e.p > o.p) seen.set(key, e);
}
const rows = [...seen.values()].sort((a, b) => b.p - a.p || a.n.localeCompare(b.n));
fs.writeFileSync(path.join(root, "src/data/gazetteer.json"), JSON.stringify({ source: "GeoNames US.zip (CC BY 4.0); US Census 2023 ZCTA gazetteer", rows: rows.map(({ n, k, y, x, m, p }) => [n, k, y, x, m, p]) }));
console.log(`gazetteer: ${rows.length} rows (${rows.filter((r) => r.k === "zip").length} zip)`);
