/** Michelin data model: award codes, tile bucketing and the search shard hash. Pure; used by the build and the browser. */
import { fold } from "./geo.ts";

/** Codes as in data/michelin-world.csv: S1 S2 S3 stars, B Bib Gourmand, G Green Star, L Selected. */
export type AwardCode = "S1" | "S2" | "S3" | "B" | "G" | "L";
export const AWARD_KIND: Record<AwardCode, "star" | "bib" | "green" | "sel"> = { S1: "star", S2: "star", S3: "star", B: "bib", G: "green", L: "sel" };
export const AWARD_LABEL: Record<AwardCode, string> = { S1: "1 Star", S2: "2 Stars", S3: "3 Stars", B: "Bib Gourmand", G: "Green Star", L: "Selected" };
/** Higher = better. Stars outrank Bib, Green, Selected. */
const RANK: Record<AwardCode, number> = { S3: 6, S2: 5, S1: 4, B: 3, G: 2, L: 1 };
export const CODES: AwardCode[] = ["L", "G", "B", "S1", "S2", "S3"];

export function codeFromText(award: string): AwardCode | null {
  const a = award.trim().toLowerCase();
  if (a.startsWith("3 star")) return "S3";
  if (a.startsWith("2 star")) return "S2";
  if (a.startsWith("1 star")) return "S1";
  if (a.startsWith("bib")) return "B";
  if (a.startsWith("green")) return "G";
  if (a.startsWith("selected")) return "L";
  return null;
}
/** "22B,23B,25L" to [{year:2022,code:"B"}...]; unknown codes are dropped. */
export function parseAwards(s: string): { year: number; code: AwardCode }[] {
  return s.split(",").map((p) => p.trim()).filter(Boolean).flatMap((p) => {
    const m = /^(\d{2})(S[123]|B|G|L)$/.exec(p);
    return m ? [{ year: 2000 + Number(m[1]), code: m[2] as AwardCode }] : [];
  });
}
export const formatAwards = (list: { year: number; code: AwardCode }[]): string => list.map((a) => `${String(a.year % 100).padStart(2, "0")}${a.code}`).join(",");
/** Best distinction (rank, then latest year) and the latest year. */
export function bestOf(list: { year: number; code: AwardCode }[]): { code: AwardCode; year: number } | null {
  let best: { code: AwardCode; year: number } | null = null;
  for (const a of list) if (!best || RANK[a.code] > RANK[best.code] || (RANK[a.code] === RANK[best.code] && a.year > best.year)) best = { code: a.code, year: a.year };
  return best;
}
export const latestYear = (list: { year: number }[]): number => list.reduce((m, a) => Math.max(m, a.year), 0);

/** Tiles: a plain slippy-map grid at TILE_Z. Zoom buckets: below LOW_MAX_ZOOM the single low file is used, above it the grid tiles. */
export const TILE_Z = 5;
export const LOW_MAX_ZOOM = 5.5;
export function tileXY(lng: number, lat: number, z = TILE_Z): [number, number] {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latR = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}
/** Tile file names ("x-y") that intersect a [west, south, east, north] view (longitudes may exceed +-180 when the map wraps). */
export function tilesForBounds(b: [number, number, number, number], z = TILE_Z): string[] {
  const n = 2 ** z;
  const [x0, y1] = tileXY(Math.max(b[0], -180), b[1], z);
  const [x1, y0] = tileXY(Math.min(b[2], 179.9999), b[3], z);
  const out: string[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${x % n}-${y}`);
  return out;
}
/** Search shards: a record lives in the shard of every token's first 3 characters. */
export const NAME_SHARDS = 64;
export function shardOf(prefix3: string): number {
  let h = 0x811c9dc5;
  for (const ch of prefix3) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h % NAME_SHARDS;
}
export const tokens = (name: string): string[] => fold(name).split(" ").filter(Boolean);
/** Shards that can hold a match for a (folded) query token, or null when the token is too short to shard. */
export function shardForQuery(token: string): number | null {
  const t = [...fold(token)].slice(0, 3);
  return t.length < 3 ? null : shardOf(t.join(""));
}
export const prefix3 = (tok: string): string => [...tok].slice(0, 3).join("");
