/** In-browser search over saved places, Michelin names and the area gazetteer (pure). No network, no address search. */
import { fold } from "./data/geo.ts";

export interface PlaceHit { kind: "place"; id: string; name: string; x: number; y: number; c: string; s: "m" | "o"; sub: string }
export interface MichelinHit { kind: "michelin"; id: string; name: string; x: number; y: number; best: string; sub: string }
export interface AreaHit { kind: "area"; name: string; x: number; y: number; area: "city" | "hood" | "zip"; sub: string }
export type Hit = PlaceHit | MichelinHit | AreaHit;

export interface PlaceRec { id: string; n: string; c: string; s: "m" | "o"; x: number; y: number; addr?: string }
export interface PlaceIndexRow { rec: PlaceRec; key: string; words: string[] }
export const buildPlaceIndex = (places: PlaceRec[]): PlaceIndexRow[] => places.map((rec) => { const key = fold(rec.n); return { rec, key, words: key.split(" ") }; });

const qTokens = (q: string): string[] => fold(q).split(" ").filter(Boolean);
/** Rank: 0 whole-name prefix, 1 every token prefixes a word, 2 substring; null = no match. */
export function rank(key: string, words: string[], toks: string[]): number | null {
  if (!toks.length) return null;
  const whole = toks.join(" ");
  if (key.startsWith(whole)) return 0;
  if (toks.every((t) => words.some((w) => w.startsWith(t)))) return 1;
  return key.includes(whole) ? 2 : null;
}
export function searchPlaces(idx: PlaceIndexRow[], q: string, limit = 6): PlaceHit[] {
  const toks = qTokens(q);
  const scored: { r: number; row: PlaceIndexRow }[] = [];
  for (const row of idx) { const r = rank(row.key, row.words, toks); if (r !== null) scored.push({ r, row }); }
  scored.sort((a, b) => a.r - b.r || (a.row.rec.s === b.row.rec.s ? 0 : a.row.rec.s === "m" ? -1 : 1) || a.row.key.length - b.row.key.length);
  return scored.slice(0, limit).map(({ row: { rec } }) => ({ kind: "place" as const, id: rec.id, name: rec.n, x: rec.x, y: rec.y, c: rec.c, s: rec.s, sub: rec.addr ?? "" }));
}

/** Gazetteer rows as shipped: [name, kind, lat, lng, metro, population]. */
export type AreaRow = [string, "city" | "hood" | "zip", number, number, string, number];
export interface AreaIndexRow { row: AreaRow; key: string; words: string[] }
export const buildAreaIndex = (rows: AreaRow[]): AreaIndexRow[] => rows.map((row) => { const key = fold(row[0]); return { row, key, words: key.split(" ") }; });
const KIND_ORDER = { city: 0, hood: 1, zip: 2 } as const;
/** The token is within one edit of a prefix of the word (so a typo near the end still matches while typing). */
export const prefixWithinOne = (w: string, t: string): boolean => [t.length - 1, t.length, t.length + 1].some((n) => n > 0 && withinOneEdit(w.slice(0, n), t));
/** True when a and b are within one edit (insert, delete or substitute). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
export function searchAreas(idx: AreaIndexRow[], q: string, limit = 5): AreaHit[] {
  const toks = qTokens(q);
  if (!toks.length) return [];
  const digits = /^\d+$/.test(toks[0]!);
  const scored: { r: number; row: AreaIndexRow }[] = [];
  for (const row of idx) {
    if (digits ? row.row[1] !== "zip" : row.row[1] === "zip") continue;
    let r = rank(row.key, row.words, toks);
    // typo tolerance: tokens of 4+ characters may be one edit away from a word (whole-name only, so it stays cheap)
    if (r === null && !digits && toks.every((t) => t.length >= 4 ? row.words.some((w) => w.length >= 4 && prefixWithinOne(w, t)) : row.words.some((w) => w.startsWith(t)))) r = 3;
    if (r !== null) scored.push({ r, row });
  }
  scored.sort((a, b) => a.r - b.r || KIND_ORDER[a.row.row[1]] - KIND_ORDER[b.row.row[1]] || b.row.row[5] - a.row.row[5] || a.row.key.length - b.row.key.length);
  return scored.slice(0, limit).map(({ row: { row: [name, area, y, x, metro] } }) => ({ kind: "area" as const, name, x, y, area, sub: area === "zip" ? `ZIP code${METRO_LABEL[metro] ? ", " + METRO_LABEL[metro] : ""}` : `${area === "hood" ? "Neighborhood" : "City"}${METRO_LABEL[metro] ? ", " + METRO_LABEL[metro] : ""}` }));
}
const METRO_LABEL: Record<string, string> = { sf: "Bay Area", sac: "Sacramento", sea: "Seattle", nyc: "New York" };

/** Michelin shard rows: [id, name, lng, lat, best, city]. Matching needs every query token to prefix a word. */
export type MichelinRow = [string, string, number, number, string, string];
export function searchMichelin(rows: MichelinRow[], q: string, limit = 4): MichelinHit[] {
  const toks = qTokens(q);
  const out: { r: number; hit: MichelinHit }[] = [];
  const seen = new Set<string>();
  for (const [id, name, x, y, best, city] of rows) {
    if (seen.has(id)) continue;
    const key = fold(name);
    const r = rank(key, key.split(" "), toks);
    if (r === null || r > 1) continue;
    seen.add(id);
    out.push({ r, hit: { kind: "michelin", id, name, x, y, best, sub: city } });
  }
  out.sort((a, b) => a.r - b.r || a.hit.name.length - b.hit.name.length);
  return out.slice(0, limit).map((o) => o.hit);
}
