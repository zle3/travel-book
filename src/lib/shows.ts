/** Shows list helpers (pure): date ranges, search, grouping. Dates are local calendar days as YYYY-MM-DD. */
import { fold } from "./data/geo.ts";

export interface ShowLike { id: string; title: string; venue?: string; city?: string; date: string; tags?: string[]; orgs?: string; when?: string }
export type Range = "today" | "weekend" | "week" | "all";

export const ymd = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number): Date => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); return x; };

/** Inclusive [from, to] day strings for a range, relative to `now`. Weekend = Friday to Sunday of this week (or today when it is already one). */
export function rangeOf(range: Range, now: Date): [string, string] {
  const today = ymd(now);
  if (range === "today") return [today, today];
  if (range === "week") return [today, ymd(addDays(now, 6))];
  if (range === "weekend") {
    const dow = now.getDay();                       // 0 Sun .. 6 Sat
    const toFri = dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow;
    const fri = addDays(now, toFri), sun = addDays(fri, 2);
    return [ymd(fri) < today ? today : ymd(fri), ymd(sun)];
  }
  return [today, "9999-12-31"];
}
export function filterShows<T extends ShowLike>(list: T[], opts: { q?: string; range: Range; now: Date }): T[] {
  const [from, to] = rangeOf(opts.range, opts.now);
  const toks = fold(opts.q ?? "").split(" ").filter(Boolean);
  return list
    .filter((e) => e.date >= from && e.date <= to)
    .filter((e) => { if (!toks.length) return true; const hay = fold([e.title, e.venue, e.city, (e.tags ?? []).join(" "), e.orgs].join(" ")); return toks.every((t) => hay.includes(t)); })
    .sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date < b.date ? -1 : 1));
}
export function groupByDate<T extends ShowLike>(list: T[]): { date: string; items: T[] }[] {
  const out: { date: string; items: T[] }[] = [];
  for (const e of list) { const g = out.at(-1); if (g && g.date === e.date) g.items.push(e); else out.push({ date: e.date, items: [e] }); }
  return out;
}
export function dayLabel(date: string, now: Date): string {
  const today = ymd(now);
  const d = new Date(`${date}T12:00:00`);
  const base = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return date === today ? `Today, ${base}` : date === ymd(addDays(now, 1)) ? `Tomorrow, ${base}` : base;
}
/** Nearest covered show region for a map centre. */
export function regionFor(lng: number, lat: number): "bayarea" | "seattle" | "losangeles" {
  const c = { bayarea: [-122.2, 37.7], seattle: [-122.33, 47.6], losangeles: [-118.24, 34.05] } as const;
  let best: keyof typeof c = "bayarea", bd = Infinity;
  for (const k of Object.keys(c) as (keyof typeof c)[]) { const d = (c[k][0] - lng) ** 2 + (c[k][1] - lat) ** 2; if (d < bd) { bd = d; best = k; } }
  return best;
}
