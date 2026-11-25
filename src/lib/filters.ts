/** Filter state and matching for saved places (pure). */
import { metroOf } from "./data/metros.ts";
import { AWARD_KIND, bestOf, parseAwards } from "./data/michelin.ts";

export type AwardKind = "star" | "bib" | "green" | "sel";
export interface Filters {
  mine: boolean; other: boolean;       // source toggles
  cats: string[];                      // category ids; empty = all
  offLists: string[];                  // list ids switched off
  regions: string[];                   // metro ids (sf sac sea nyc other); empty = all
  hideBeen: boolean;
  mich: AwardKind[];                   // saved places must hold one of these; empty = no award filter
  anyYear: boolean;                    // false = current edition only
  michelinLayer: boolean;              // browsable world layer
}
export const defaultFilters = (): Filters => ({ mine: true, other: true, cats: [], offLists: [], regions: [], hideBeen: false, mich: [], anyYear: true, michelinLayer: false });

export interface PlaceLike { c: string; s: "m" | "o"; l: string[]; x: number; y: number; been?: boolean; mich?: string }
export interface FilterCtx { currentEdition: number }

/** Award kinds a place holds (all years, or the current edition only). */
export function awardKinds(mich: string | undefined, anyYear: boolean, edition: number): AwardKind[] {
  if (!mich) return [];
  const aw = parseAwards(mich).filter((a) => anyYear || a.year === edition);
  return [...new Set(aw.map((a) => AWARD_KIND[a.code]))];
}
export function matches(p: PlaceLike, f: Filters, ctx: FilterCtx): boolean {
  if (p.s === "m" ? !f.mine : !f.other) return false;
  if (f.cats.length && !f.cats.includes(p.c)) return false;
  if (f.offLists.length && p.l.every((l) => f.offLists.includes(l))) return false;
  if (f.regions.length && !f.regions.includes(metroOf(p.x, p.y))) return false;
  if (f.hideBeen && p.been) return false;
  if (f.mich.length) { const k = awardKinds(p.mich, f.anyYear, ctx.currentEdition); if (!k.some((x) => f.mich.includes(x))) return false; }
  return true;
}
/** Number shown on the Filters button: each narrowing control counts once. */
export function activeCount(f: Filters): number {
  return (f.mine && f.other ? 0 : 1) + (f.cats.length ? 1 : 0) + (f.offLists.length ? 1 : 0) + (f.regions.length ? 1 : 0) + (f.hideBeen ? 1 : 0) + (f.mich.length ? 1 : 0) + (f.mich.length && !f.anyYear ? 1 : 0) + (f.michelinLayer ? 1 : 0);
}
export const bestAward = (mich?: string) => (mich ? bestOf(parseAwards(mich)) : null);

/** Toggle a set of category ids (a chip): all in = remove them, else add them. */
export function toggleCats(cur: string[], ids: string[]): string[] {
  const all = ids.every((i) => cur.includes(i));
  return all ? cur.filter((c) => !ids.includes(c)) : [...new Set([...cur, ...ids])];
}
export const toggleIn = <T,>(cur: T[], v: T): T[] => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]);

/** Storage round trip: unknown or broken input falls back to defaults field by field. */
export function parseFilters(raw: unknown): Filters {
  const d = defaultFilters();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 100) : []);
  const kinds: AwardKind[] = ["star", "bib", "green", "sel"];
  return {
    mine: typeof o.mine === "boolean" ? o.mine : d.mine, other: typeof o.other === "boolean" ? o.other : d.other,
    cats: strs(o.cats), offLists: strs(o.offLists), regions: strs(o.regions),
    hideBeen: o.hideBeen === true, mich: strs(o.mich).filter((k): k is AwardKind => (kinds as string[]).includes(k)),
    anyYear: o.anyYear !== false, michelinLayer: o.michelinLayer === true,
  };
}
