#!/usr/bin/env node
// Build public/data/hoods/sf.json from data/sf-neighborhoods.geojson (DataSF "Analysis Neighborhoods", public domain).
//   node scripts/data/build-hoods.mjs            write the file
//   node scripts/data/build-hoods.mjs --check    exit 1 when the committed file is stale
// Simplification is topology preserving: vertices shared by two neighborhoods are fixed anchors, the runs between anchors
// are simplified once (Douglas-Peucker) and both neighbors reuse the same result, so borders stay gaps-and-overlaps free.
// Coordinates are rounded to 5 decimals. The file also holds a place-id -> neighborhood map (point-in-polygon on the
// current places data), so the browser never runs point-in-polygon for saved places.
import fs from "node:fs";
import path from "node:path";
import { hoodSlug, inHood } from "../../src/lib/hoods.ts";

const root = path.resolve(import.meta.dirname, "../..");
const CHECK = process.argv.includes("--check");
const TOL = 0.00022; // degrees, about 24 m: roughly 1.5% of a small neighborhood's width
const OUT = "public/data/hoods/sf.json";
const r5 = (n) => Math.round(n * 1e5) / 1e5;
const key = (p) => `${p[0]},${p[1]}`;

const src = JSON.parse(fs.readFileSync(path.join(root, "data/sf-neighborhoods.geojson"), "utf8"));

function dp(pts, tol) { // Douglas-Peucker on an open run; returns kept points
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop();
    let md = 0, mi = -1;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d;
      if (L === 0) d = Math.hypot(px - ax, py - ay);
      else { const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)); d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); }
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Every ring, open (no repeated closing vertex), with rounded coordinates.
const polys = src.features.map((f) => {
  const name = f.properties.nhood;
  const mp = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  return { name, rings: mp.map((poly) => poly.map((ring) => { const r = ring.map((c) => [r5(c[0]), r5(c[1])]); if (key(r[0]) === key(r.at(-1))) r.pop(); return r; })) };
});
// A vertex used by more than one ring is shared border.
const uses = new Map();
for (const h of polys) for (const poly of h.rings) for (const ring of poly) { const seen = new Set(ring.map(key)); for (const k of seen) uses.set(k, (uses.get(k) ?? 0) + 1); }
const shared = (p) => (uses.get(key(p)) ?? 0) > 1;

const arcCache = new Map();
function simplifyRing(ring) {
  const anchors = ring.map((p, i) => (shared(p) ? i : -1)).filter((i) => i >= 0);
  if (anchors.length < 2) { // a ring with no neighbor: anchor its first and the farthest vertex
    const far = ring.reduce((b, p, i) => (Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]) > b[0] ? [Math.hypot(p[0] - ring[0][0], p[1] - ring[0][1]), i] : b), [0, 0])[1];
    const a = [0, far];
    const run1 = ring.slice(0, far + 1), run2 = [...ring.slice(far), ring[0]];
    const out = [...dp(run1, TOL).slice(0, -1), ...dp(run2, TOL).slice(0, -1)];
    return a && out.length >= 3 ? out : ring;
  }
  const out = [];
  for (let k = 0; k < anchors.length; k++) {
    const s = anchors[k], e = anchors[(k + 1) % anchors.length];
    const run = s <= e ? ring.slice(s, e + 1) : [...ring.slice(s), ...ring.slice(0, e + 1)];
    const fk = run.map(key).join(";"), rk = [...run].reverse().map(key).join(";");
    let res;
    if (arcCache.has(fk)) res = arcCache.get(fk);
    else if (arcCache.has(rk)) res = [...arcCache.get(rk)].reverse();
    else { res = dp(run, TOL); arcCache.set(fk, res); }
    out.push(...res.slice(0, -1));
  }
  return out;
}

const area = (ring) => { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return a / 2; };
// Outer rings counter-clockwise, holes clockwise (RFC 7946), closed.
const close = (ring, outer) => { const r = (area(ring) > 0) === outer ? ring : [...ring].reverse(); return [...r, r[0]]; };

/** A point well inside the shape for the label: the grid sample farthest from every edge of the largest polygon. */
function labelPoint(poly, b) {
  const edges = []; for (const ring of poly) for (let i = 0; i < ring.length - 1; i++) edges.push([ring[i], ring[i + 1]]);
  const dist = (x, y) => { let m = Infinity; for (const [[ax, ay], [bx, by]] of edges) { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0; m = Math.min(m, Math.hypot(x - ax - t * dx, y - ay - t * dy)); } return m; };
  let best = null;
  const N = 28;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const x = b[0] + ((b[2] - b[0]) * i) / N, y = b[1] + ((b[3] - b[1]) * j) / N;
    if (!inHood(x, y, { s: "", n: "", b, c: [0, 0], p: [poly] })) continue;
    const d = dist(x, y);
    if (!best || d > best[0]) best = [d, x, y];
  }
  return best ? [r5(best[1]), r5(best[2])] : [r5((b[0] + b[2]) / 2), r5((b[1] + b[3]) / 2)];
}

const hoods = polys.map((h) => {
  const p = h.rings.map((poly) => poly.map((ring, i) => close(simplifyRing(ring), i === 0)));
  const xs = p.flat(2).map((c) => c[0]), ys = p.flat(2).map((c) => c[1]);
  const b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const big = p.reduce((m, q) => (Math.abs(area(q[0])) > Math.abs(area(m[0])) ? q : m));
  return { s: hoodSlug(h.name), n: h.name, b, c: labelPoint(big, b), p };
}).sort((a, b) => a.n.localeCompare(b.n));
if (new Set(hoods.map((h) => h.s)).size !== hoods.length) throw new Error("duplicate neighborhood slug");

// Place id -> neighborhood (grouped by slug, which is the smallest shape for 2,000+ ids).
const manifest = JSON.parse(fs.readFileSync(path.join(root, "src/generated/manifest.json"), "utf8"));
const places = JSON.parse(fs.readFileSync(path.join(root, "public", manifest.places), "utf8")).features;
const inn = Object.fromEntries(hoods.map((h) => [h.s, []]));
for (const f of places) {
  const [x, y] = f.geometry.coordinates;
  if (x < -122.53 || x > -122.33 || y < 37.69 || y > 37.84) continue;
  const h = hoods.find((q) => inHood(x, y, q));
  if (h) inn[h.s].push(f.properties.id);
}
for (const k of Object.keys(inn)) inn[k].sort();

const text = JSON.stringify({ v: 1, src: "DataSF Analysis Neighborhoods (public domain)", hoods, in: inn });
const file = path.join(root, OUT);
if (CHECK) {
  const cur = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (cur !== text) { console.error(`${OUT} is stale: run node scripts/data/build-hoods.mjs`); process.exit(1); }
  console.log(`${OUT} is current`);
} else {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const gz = (await import("node:zlib")).gzipSync(text).length;
  console.log(`${OUT}: ${(text.length / 1024).toFixed(1)} KB, ${(gz / 1024).toFixed(1)} KB gzipped, ${hoods.length} neighborhoods, ${Object.values(inn).flat().length} places mapped`);
}
