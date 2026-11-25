#!/usr/bin/env node
// Build every static data file the site ships. Deterministic: same inputs, same bytes. Commit the output.
//   node scripts/data/build-data.mjs            write public/data, public/michelin, public/search, src/generated/manifest.json
//   node scripts/data/build-data.mjs --check    exit 1 when the committed output is stale (used by the unit tests)
// Inputs: src/data/gmaps.json, src/data/michelin-matches.json, src/data/gazetteer.json, data/michelin-world.csv.
// Michelin: zoom-bucketed static files (low.json for z0-5.5, a z5 grid of tiles above, 256 detail shards, 64 name-search shards).
// Every file stays far below the Workers 25 MiB asset limit (the build asserts it).
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fold, round } from "../../src/lib/data/geo.ts";
import { AWARD_LABEL, NAME_SHARDS, TILE_Z, bestOf, parseAwards, prefix3, shardOf, tileXY, tokens } from "../../src/lib/data/michelin.ts";
import { buildPlaces } from "../../src/lib/data/places.ts";
import { cleanNote } from "./notes.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const CHECK = process.argv.includes("--check");
const MAX_BYTES = 25 * 1024 * 1024;
const files = new Map(); // relative path -> string
const put = (rel, text) => { if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(`${rel} exceeds 25 MiB`); files.set(rel, text); };
const hash = (text) => createHash("sha1").update(text).digest("hex").slice(0, 10);
const readJSON = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));

// ---- saved places
const categories = readJSON("src/assets/design/categories.json").categories;
const gm = readJSON("src/data/gmaps.json");
const matches = readJSON("src/data/michelin-matches.json").matches ?? {};
const { places, lists } = buildPlaces(gm.lists, categories, matches);
const geo = {
  type: "FeatureCollection",
  features: places.map((p) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [p.x, p.y] },
    properties: { id: p.id, n: p.n, c: p.c, s: p.s, l: p.l, ...(cleanNote(p.note) ? { note: cleanNote(p.note) } : {}), ...(p.addr ? { addr: p.addr } : {}), ...(p.maps ? { maps: p.maps } : {}), ...(p.mich ? { mich: p.mich } : {}), ...(p.ex ? { ex: 1 } : {}), ...(p.br ? { br: p.br } : {}) },
  })),
};
const placesText = JSON.stringify(geo);
const placesName = `data/places.${hash(placesText)}.json`;
put(placesName, placesText);

// ---- gazetteer (compact rows: name, kind, lat, lng, metro, population)
const gaz = readJSON("src/data/gazetteer.json");
const areasText = JSON.stringify(gaz.rows);
const areasName = `search/areas.${hash(areasText)}.json`;
put(areasName, areasText);

// ---- Michelin
const csv = fs.readFileSync(path.join(root, "data/michelin-world.csv"), "utf8");
function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur.replace(/\r$/, "")); rows.push(row); row = []; cur = ""; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}
const [head, ...body] = parseCSV(csv);
const col = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
const rest = [];
for (const r of body) {
  const lat = +r[col.lat], lng = +r[col.lng];
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !r[col.id]) continue;
  const aw = parseAwards(r[col.awards_by_year] ?? "");
  const best = bestOf(aw)?.code ?? (r[col.best_award_code] || "L");
  rest.push({ id: r[col.id], name: r[col.name], city: r[col.city], country: r[col.country], lat, lng, best, yr: +r[col.latest_year] || 0, awards: r[col.awards_by_year] ?? "", url: (r[col.url] ?? "").replace("https://guide.michelin.com/", "") });
}
rest.sort((a, b) => (a.id < b.id ? -1 : 1));
// low.json: every point as [lng, lat, best, latestYear], 2 decimals (about 1 km), for the z0-5.5 dots.
put("michelin/low.json", JSON.stringify(rest.map((p) => [round(p.lng, 2), round(p.lat, 2), p.best, p.yr])));
// z5 grid tiles: [id, lng, lat, best, latestYear, name]
const tiles = new Map();
for (const p of rest) {
  const [x, y] = tileXY(p.lng, p.lat, TILE_Z);
  const k = `${x}-${y}`; (tiles.get(k) ?? tiles.set(k, []).get(k)).push([p.id, round(p.lng, 5), round(p.lat, 5), p.best, p.yr, p.name]);
}
for (const [k, v] of [...tiles].sort()) put(`michelin/t/${k}.json`, JSON.stringify(v));
// details shards by id prefix (ids are 8 hex)
const det = new Map();
for (const p of rest) { const k = p.id.slice(0, 2); (det.get(k) ?? det.set(k, {}).get(k))[p.id] = { n: p.name, c: p.city, k: p.country, a: p.awards, u: p.url }; }
for (const [k, v] of [...det].sort()) put(`michelin/d/${k}.json`, JSON.stringify(v));
// name search shards: a record sits in the shard of each token's first 3 characters
const shards = Array.from({ length: NAME_SHARDS }, () => []);
for (const p of rest) {
  const used = new Set();
  for (const t of tokens(p.name)) { const pre = prefix3(t); if ([...pre].length < 3) continue; const s = shardOf(pre); if (!used.has(s)) { used.add(s); shards[s].push([p.id, p.name, round(p.lng, 5), round(p.lat, 5), p.best, p.city]); } }
}
shards.forEach((v, i) => put(`search/mn-${String(i).padStart(2, "0")}.json`, JSON.stringify(v)));

// ---- manifest
const years = [...new Set(rest.flatMap((p) => parseAwards(p.awards).map((a) => a.year)))].sort();
const manifest = {
  places: `/${placesName}`, areas: `/${areasName}`,
  counts: { places: places.length, michelin: rest.length },
  lists, michelinYears: years, currentEdition: years.at(-1) ?? 0,
  awardLabels: AWARD_LABEL,
  hasBeen: false,
};
files.set("__manifest", JSON.stringify(manifest, null, 1) + "\n");

// ---- write or check
const outDirs = ["public/data", "public/michelin", "public/search"];
const wanted = new Map([...files].filter(([k]) => k !== "__manifest").map(([k, v]) => [`public/${k}`, v]));
wanted.set("src/generated/manifest.json", files.get("__manifest"));
const have = new Set(outDirs.flatMap((d) => (fs.existsSync(path.join(root, d)) ? walk(path.join(root, d)).map((f) => path.relative(root, f)) : [])));
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])); }
const stale = [];
for (const [rel, text] of wanted) { const f = path.join(root, rel); if (!fs.existsSync(f) || fs.readFileSync(f, "utf8") !== text) stale.push(rel); }
for (const rel of have) if (!wanted.has(rel)) stale.push(`extra:${rel}`);
if (CHECK) {
  if (stale.length) { console.error(`stale generated data (${stale.length}): ${stale.slice(0, 5).join(", ")}. Run node scripts/data/build-data.mjs`); process.exit(1); }
  console.log("generated data is current"); process.exit(0);
}
for (const rel of have) if (!wanted.has(rel)) fs.rmSync(path.join(root, rel));
for (const [rel, text] of wanted) { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
const total = [...wanted.values()].reduce((n, t) => n + Buffer.byteLength(t), 0);
console.log(`places ${places.length} (${(Buffer.byteLength(placesText) / 1024).toFixed(0)} KB), michelin ${rest.length}, ${tiles.size} tiles, ${wanted.size} files, ${(total / 1048576).toFixed(1)} MiB`);
