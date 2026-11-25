/** Build the saved-places dataset: merge the Google lists into one record per place (pure, unit-tested). */
import { distanceM, fold, round } from "./geo.ts";
import { bestOf, codeFromText, formatAwards, parseAwards } from "./michelin.ts";
import type { AwardCode } from "./michelin.ts";
import { createHash } from "node:crypto";

export interface RawPlace { name: string; address?: string; lat: number; lng: number; note?: string; maps?: string; category?: string; group?: string }
export interface RawList { name: string; source: "mine" | "other"; places: RawPlace[] }
export interface Category { id: string; label: string; group: string }
export interface Place {
  id: string; n: string; c: string; s: "m" | "o"; l: string[]; note: string; addr: string; maps: string; x: number; y: number; mich?: string;
}
export const slug = (s: string): string => fold(s).replace(/ /g, "-");
export const MERGE_RADIUS_M = 60;

type MatchMap = Record<string, { year: number; award: string; distinction?: boolean }[]>;

function stableId(p: RawPlace): string {
  const cid = /cid=(\d+)/.exec(p.maps ?? "")?.[1];
  const seed = cid ? `cid:${cid}` : `${fold(p.name)}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
  return BigInt("0x" + createHash("sha1").update(seed).digest("hex").slice(0, 12)).toString(36);
}

/** One record per physical place: same folded name within 60 m merges and unions the lists. Mine wins category and note. */
export function buildPlaces(lists: RawList[], categories: Category[], matches: MatchMap = {}): { places: Place[]; lists: { id: string; name: string; source: "m" | "o"; count: number }[] } {
  const catByLabel = new Map(categories.map((c) => [fold(c.label), c.id]));
  const out: Place[] = [];
  const byName = new Map<string, Place[]>();
  const awardsOf = new Map<string, { year: number; code: AwardCode }[]>();
  // Mine first so its category and note win.
  const ordered = [...lists].sort((a, b) => (a.source === b.source ? 0 : a.source === "mine" ? -1 : 1));
  for (const list of ordered) {
    const lid = slug(list.name);
    const src = list.source === "mine" ? "m" : "o";
    for (const rp of list.places) {
      if (!Number.isFinite(rp.lat) || !Number.isFinite(rp.lng)) continue;
      const key = fold(rp.name);
      const near = (byName.get(key) ?? []).find((q) => distanceM(q.x, q.y, rp.lng, rp.lat) <= MERGE_RADIUS_M);
      const aw = matches[rp.maps ?? ""];
      if (near) {
        if (!near.l.includes(lid)) near.l.push(lid);
        if (!near.note && rp.note) near.note = rp.note;
        if (!near.addr && rp.address) near.addr = rp.address;
        if (src === "m") near.s = "m";
        if (aw && !awardsOf.has(near.id)) awardsOf.set(near.id, aw.flatMap((a) => { const c = codeFromText(a.award); return c ? [{ year: a.year, code: c }] : []; }));
        continue;
      }
      const p: Place = {
        id: stableId(rp), n: rp.name, c: catByLabel.get(fold(rp.category ?? "")) ?? "other", s: src, l: [lid],
        note: rp.note ?? "", addr: rp.address ?? "", maps: rp.maps ?? "", x: round(rp.lng, 5), y: round(rp.lat, 5),
      };
      if (aw) awardsOf.set(p.id, aw.flatMap((a) => { const c = codeFromText(a.award); return c ? [{ year: a.year, code: c }] : []; }));
      out.push(p);
      const arr = byName.get(key) ?? []; arr.push(p); byName.set(key, arr);
    }
  }
  // Unique ids (a collision would break picks): extend the id with a counter.
  const seen = new Set<string>();
  for (const p of out) { let id = p.id; for (let i = 1; seen.has(id); i++) id = `${p.id}${i}`; p.id = id; seen.add(id); }
  for (const p of out) { const a = awardsOf.get(p.id); if (a?.length && bestOf(a)) p.mich = formatAwards(a.sort((x, y) => x.year - y.year)); }
  const counts = new Map<string, number>();
  for (const p of out) for (const l of p.l) counts.set(l, (counts.get(l) ?? 0) + 1);
  return {
    places: out,
    lists: lists.map((l) => ({ id: slug(l.name), name: l.name, source: l.source === "mine" ? ("m" as const) : ("o" as const), count: counts.get(slug(l.name)) ?? 0 })),
  };
}
export { parseAwards };
