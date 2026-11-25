#!/usr/bin/env node
// Build the basemap assets the site ships (run once, commit the output).
//   public/style/home-{light,dark}.json   Protomaps basemap layers (source "base-home", ids h-*) from @protomaps/basemaps, tinted with FLAVOR
//   public/basemap/land.json, cities.json  low-zoom world overview shipped statically (Natural Earth, public domain), so the map is never blank offline
//   public/glyphs/noto-{regular,medium,italic}/<range>.pbf   self-hosted label fonts (Noto Sans, from protomaps/basemaps-assets, OFL)
// Usage: node scripts/data/build-basemap.mjs [--cache <dir>]
//
// Optional upgrade (owner choice, see docs/ROUTES.md): a static PMTiles extract of the planet for z0-5 plus covered regions to z10 can be made with
//   pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles world-z0-6.pmtiles --maxzoom=6
// and shipped under public/basemap/. v1 ships the lighter GeoJSON overview instead.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { FLAVOR } from "../../src/assets/design/map-config.js";

const root = path.resolve(import.meta.dirname, "../..");
const argv = process.argv.slice(2);
const cache = path.resolve(argv.includes("--cache") ? argv[argv.indexOf("--cache") + 1] : path.join(os.tmpdir(), "travel-basemap"));
fs.mkdirSync(cache, { recursive: true });
const out = (rel, data) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
async function get(url, name) {
  const f = path.join(cache, name);
  if (!fs.existsSync(f)) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
  return f;
}

const FONT = { "Noto Sans Regular": "noto-regular", "Noto Sans Medium": "noto-medium", "Noto Sans Italic": "noto-italic" };
for (const theme of ["light", "dark"]) {
  const flavor = { ...namedFlavor(theme), ...FLAVOR[theme] };
  let L = layers("base-home", flavor, { lang: "en" }).filter((l) => !["background", "pois", "roads_shields", "roads_oneway"].includes(l.id));
  L = L.map((l) => { if (l.layout) delete l.layout["icon-image"]; return { ...l, id: `h-${l.id}` }; });
  let text = JSON.stringify(L);
  for (const [k, v] of Object.entries(FONT)) text = text.split(`"${k}"`).join(`"${v}"`);
  out(`public/style/home-${theme}.json`, text);
}

const round = (n) => Math.round(n * 100) / 100;
const roundCoords = (c) => (typeof c[0] === "number" ? c.map(round) : c.map(roundCoords));
const land = JSON.parse(fs.readFileSync(await get("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson", "land.geojson"), "utf8"));
land.features.forEach((f) => { f.properties = {}; f.geometry.coordinates = roundCoords(f.geometry.coordinates); });
delete land.crs; delete land.name;
out("public/basemap/land.json", JSON.stringify(land));
const pp = JSON.parse(fs.readFileSync(await get("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_populated_places_simple.geojson", "cities.geojson"), "utf8"));
out("public/basemap/cities.json", JSON.stringify({ type: "FeatureCollection", features: pp.features.map((f) => ({ type: "Feature", properties: { name: f.properties.name, r: f.properties.scalerank ?? 5 }, geometry: { type: "Point", coordinates: f.geometry.coordinates.map(round) } })) }));

for (const [name, dir] of Object.entries({ "Noto%20Sans%20Regular": "noto-regular", "Noto%20Sans%20Medium": "noto-medium", "Noto%20Sans%20Italic": "noto-italic" })) {
  for (const range of ["0-255", "256-511"]) out(`public/glyphs/${dir}/${range}.pbf`, fs.readFileSync(await get(`https://protomaps.github.io/basemaps-assets/fonts/${name}/${range}.pbf`, `${dir}-${range}.pbf`)));
}
console.log("basemap assets written");
