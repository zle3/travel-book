/** San Francisco neighborhoods: the compact data format, point-in-polygon, counts and the hash deep link. Pure: no DOM. Shared by the build script and the browser. */
export type Pt = [number, number];
/** One polygon: the outer ring first, then holes. */
export type Poly = Pt[][];
export interface Hood { s: string; n: string; b: [number, number, number, number]; c: Pt; p: Poly[] }
export interface HoodsFile { v: 1; src: string; hoods: Hood[]; in: Record<string, string[]> }

export const CITY_SF = "sf";
/** "Sunset/Parkside" -> "sunset-parkside". */
export const hoodSlug = (name: string): string => name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function inRing(x: number, y: number, ring: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function inPoly(x: number, y: number, poly: Poly): boolean {
  if (!poly[0] || !inRing(x, y, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (inRing(x, y, poly[i]!)) return false;
  return true;
}
export const inHood = (x: number, y: number, h: Hood): boolean => x >= h.b[0] && x <= h.b[2] && y >= h.b[1] && y <= h.b[3] && h.p.some((p) => inPoly(x, y, p));
/** The neighborhood slug holding a point, or null. Neighborhoods tile the city, so the first hit wins. */
export function hoodAt(x: number, y: number, hoods: Hood[]): string | null {
  for (const h of hoods) if (inHood(x, y, h)) return h.s;
  return null;
}

/** Place id -> slug, from the precomputed lists; ids the build did not see (live and guide-only places) fall back to point-in-polygon. */
export function indexHoods(file: HoodsFile): Map<string, string> {
  const m = new Map<string, string>();
  for (const [slug, ids] of Object.entries(file.in)) for (const id of ids) m.set(id, slug);
  return m;
}
export function hoodOf(id: string, x: number, y: number, idx: Map<string, string>, hoods: Hood[]): string | null {
  const hit = idx.get(id);
  if (hit) return hit;
  const s = hoodAt(x, y, hoods);
  if (s) idx.set(id, s);
  return s;
}

/** Hood GeoJSON for the map: polygons with slug and name. */
export function hoodsGeoJSON(hoods: Hood[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: hoods.map((h) => ({ type: "Feature", properties: { slug: h.s, name: h.n }, geometry: { type: "MultiPolygon", coordinates: h.p } })) };
}
/** One label point per neighborhood (inside the shape). */
export function hoodLabelsGeoJSON(hoods: Hood[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: hoods.map((h) => ({ type: "Feature", properties: { slug: h.s, name: h.n }, geometry: { type: "Point", coordinates: h.c } })) };
}

/** Hash: `#city=sf` and `#city=sf&hood=<slug>`. */
export function parseCityHash(hash: string): { city: boolean; hood: string | null } {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const city = q.get("city") === CITY_SF;
  const hood = q.get("hood");
  return { city, hood: city && hood && /^[a-z0-9-]{1,60}$/.test(hood) ? hood : null };
}
export const cityHash = (city: boolean, hood: string | null): string => (city ? `#city=${CITY_SF}${hood ? `&hood=${hood}` : ""}` : "");
