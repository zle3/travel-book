/** Area guides: a curated list for one part of a city. Items are resolved against the saved places by name (case and punctuation
 * insensitive), with the address, then the distance to the guide's anchor, as tiebreaks. Items with coordinates and no match
 * become guide-only pins. Pure: no DOM. */
import { distanceM, fold } from "./data/geo.ts";

export interface GuideItem { name: string; note?: string; address?: string; lat?: number; lng?: number }
export interface GuideData {
  id: string; city: string; title: string; subtitle: string;
  anchor: GuideItem;
  groups: { title: string; items: GuideItem[] }[];
}
export interface GuideIndexRow { id: string; city: string; title: string; subtitle: string; file: string }
/** What the resolver needs of a saved place; the app's Place satisfies it. */
export interface PlaceLike { id: string; n: string; c: string; x: number; y: number; addr: string }
export interface GuidePlace extends PlaceLike { s: "m"; l: string[]; note: string; maps: string }
export interface ResolvedItem { place: PlaceLike; guideOnly: boolean; note: string; fromAnchorM: number | null }
export interface ResolvedGuide {
  id: string; title: string; subtitle: string; city: string;
  anchor: ResolvedItem | null;
  groups: { title: string; items: ResolvedItem[] }[];
  /** Every pin the guide shows, anchor included. */
  places: PlaceLike[];
  /** Guide-only pins (not in the saved places); the app registers them so hearts and picks work. */
  extras: GuidePlace[];
  bounds: [number, number, number, number] | null;
}

const hash36 = (s: string): string => { let h = 5381; for (const ch of s) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0; return h.toString(36).slice(0, 5); };
/** Ids are [0-9a-z]{1,16} like every pick id. */
export const guidePlaceId = (guideId: string, index: number): string => `g${hash36(guideId)}${index.toString(36)}`;
const catFor = (group: string): string => (/museum|art/i.test(group) ? "museums" : "points-of-interest");
const streetKey = (addr: string): string => fold(addr.split(",")[0] ?? "").split(" ").slice(0, 2).join(" ");

export function resolveGuide(guide: GuideData, places: PlaceLike[]): ResolvedGuide {
  const byName = new Map<string, PlaceLike[]>();
  for (const p of places) { const k = fold(p.n); const a = byName.get(k); if (a) a.push(p); else byName.set(k, [p]); }
  const hasA = typeof guide.anchor.lat === "number" && typeof guide.anchor.lng === "number";
  const ax = guide.anchor.lng ?? 0, ay = guide.anchor.lat ?? 0;
  const dist = (p: { x: number; y: number }): number | null => (hasA ? distanceM(ax, ay, p.x, p.y) : null);
  const extras: GuidePlace[] = [];
  let seq = 0;

  const pick = (it: GuideItem): PlaceLike | null => {
    const c = byName.get(fold(it.name)) ?? [];
    if (c.length <= 1) return c[0] ?? null;
    if (it.address) { const k = streetKey(it.address); const m = c.filter((p) => k && streetKey(p.addr) === k); if (m.length) return m[0]!; }
    if (hasA) return c.slice().sort((a, b) => distanceM(ax, ay, a.x, a.y) - distanceM(ax, ay, b.x, b.y))[0]!;
    return c[0]!;
  };
  const make = (it: GuideItem, group: string): ResolvedItem | null => {
    const found = pick(it);
    if (found) return { place: found, guideOnly: false, note: it.note ?? "", fromAnchorM: dist(found) };
    if (typeof it.lat === "number" && typeof it.lng === "number") {
      const gp: GuidePlace = { id: guidePlaceId(guide.id, seq++), n: it.name, c: catFor(group), s: "m", l: [], note: it.note ?? "", addr: it.address ?? "", maps: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${it.name} ${guide.city}`)}`, x: it.lng, y: it.lat };
      extras.push(gp);
      return { place: gp, guideOnly: true, note: it.note ?? "", fromAnchorM: dist(gp) };
    }
    return null;
  };

  const anchor = make(guide.anchor, "");
  const groups = guide.groups.map((g) => ({ title: g.title, items: g.items.flatMap((it) => { const r = make(it, g.title); return r ? [r] : []; }) })).filter((g) => g.items.length);
  const seen = new Set<string>(), all: PlaceLike[] = [];
  for (const r of [anchor, ...groups.flatMap((g) => g.items)]) if (r && !seen.has(r.place.id)) { seen.add(r.place.id); all.push(r.place); }
  const bounds: [number, number, number, number] | null = all.length ? [Math.min(...all.map((p) => p.x)), Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.x)), Math.max(...all.map((p) => p.y))] : null;
  return { id: guide.id, title: guide.title, subtitle: guide.subtitle, city: guide.city, anchor, groups, places: all, extras, bounds };
}

/** Rough San Francisco box: the Guides section shows when the map centre is inside it. */
export const SF_BOX: [number, number, number, number] = [-122.52, 37.70, -122.35, 37.84];
export const inBox = (lng: number, lat: number, b: [number, number, number, number]): boolean => lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
