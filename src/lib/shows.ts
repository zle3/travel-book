/** Shows list helpers (pure): date ranges, search, grouping. Dates are local calendar days as YYYY-MM-DD. */
import { fold } from "./data/geo.ts";
import type { WeatherAlert } from "./weather.ts";

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

// ---- row copy for the Shows tab
const DATE_PART = /(?:([A-Z][a-z]{2}):?\s+)?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\b/g;
const CLOCK_12 = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b\.?/gi;
const CLOCK_24 = /^\s*(\d{1,2}):(\d{2})\s*$/;

/** "9pm", "9:30pm" from a 12-hour match, or from a 24-hour "21:00" (owner-added events). */
function clockLabel(h: number, m: number, ap: string): string {
  return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""}${ap.toLowerCase()}m`;
}

/** Time and multi-day span of a 19hz "when" string such as "Wed: Nov 25 (9pm-2am)" or "Fri: Dec 4-Sat: Dec 5 (9pm)". Unknown input gives empty parts. */
export function parseShowWhen(when: string | undefined): { time: string; span: string } {
  const raw = (when ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { time: "", span: "" };
  const h24 = CLOCK_24.exec(raw);
  if (h24) {
    const h = Number(h24[1]), m = Number(h24[2]);
    if (h > 23 || m > 59) return { time: "", span: "" };
    return { time: clockLabel(h % 12 || 12, m, h >= 12 ? "p" : "a"), span: "" };
  }
  const times = [...raw.matchAll(CLOCK_12)].map((t) => clockLabel(Number(t[1]), Number(t[2] ?? 0), t[3]!));
  const time = times.length >= 2 ? `${times[0]}–${times[1]}` : (times[0] ?? "");
  const dates = [...raw.matchAll(DATE_PART)].map((d) => ({ wd: d[1] ?? "", mon: d[2]!, day: Number(d[3]) }));
  let span = "";
  if (dates.length >= 2) {
    const first = dates[0]!, last = dates.at(-1)!;
    if (first.mon === last.mon && first.day === last.day && first.wd === last.wd) span = "";
    else if (first.mon === last.mon) span = `${first.wd && last.wd ? `${first.wd}–${last.wd}, ` : ""}${first.mon} ${first.day}–${last.day}`;
    else span = `${first.mon} ${first.day}–${last.mon} ${last.day}`;
  }
  return { time, span };
}

/** One line under a day header: "9pm–2am · 1015 Folsom, San Francisco". The day header already names the date, so single-day dates are dropped. */
export function formatShowLine(e: { when?: string; venue?: string; city?: string }): string {
  const { time, span } = parseShowWhen(e.when);
  const clean = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().replace(/^[(\[]\s*|\s*[)\]]$/g, "").trim();
  const place = [clean(e.venue), clean(e.city)].filter(Boolean).join(", ");
  return [span, time, place].filter(Boolean).join(" · ");
}

// ---- weather alert card copy (pure; the sheet in client/weather-ui.ts renders it)
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** An alert as the page shows it. `description` and `url` are optional: the Worker may send them (NWS sends a description and a link). */
export type AlertView = WeatherAlert & { description?: string; url?: string };

/** "until Nov 26, 6pm" from the NWS end time (local time of the alert area, read from the string). Empty when missing or unreadable. */
export function untilLabel(ends: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(ends ?? "");
  if (!m) return "";
  const month = Number(m[2]), day = Number(m[3]), h = Number(m[4]), min = Number(m[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || h > 23 || min > 59) return "";
  const clock = `${h % 12 || 12}${min ? `:${String(min).padStart(2, "0")}` : ""}${h >= 12 ? "pm" : "am"}`;
  return `until ${MON[month - 1]} ${day}, ${clock}`;
}

/** The first sentence of a text, capped, so the card stays short. */
export function firstSentence(text: string): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  const end = /[.!?](\s|$)/.exec(t);
  const out = end ? t.slice(0, end.index + 1) : t;
  return out.length > 200 ? `${out.slice(0, 199).trimEnd()}\u2026` : out;
}

/** Body text under the title. The headline usually repeats the title ("Coastal Flood Warning issued ..."), so the title and the issued clause are removed. */
export function alertBody(a: AlertView): string {
  if (a.description?.trim()) return firstSentence(a.description);
  const title = (a.event ?? "").trim();
  let rest = (a.headline ?? "").trim();
  if (title && rest.toLowerCase().startsWith(title.toLowerCase())) rest = rest.slice(title.length);
  rest = rest.replace(/^\s*(issued|in effect|continues)\b.*$/i, "");
  return firstSentence(rest.replace(/^[\s,:.-]+/, ""));
}

/** Only https links leave the card. */
export function safeMoreUrl(url: string | undefined): string {
  return /^https:\/\/[^\s"<>]+$/.test(url ?? "") ? (url as string) : "";
}
