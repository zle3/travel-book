/** Parser for the 19hz.info event listing table (https://19hz.info/eventlisting_<BayArea|Seattle|LosAngeles>.php).
 * Rows: when | "title @ venue (city)" | tags | price / age | organizers | links | trailing YYYY/MM/DD. The markup leaves the second
 * cell unclosed, so rows and cells are split on their opening tags rather than parsed as a tree. Dependency-free. */
export interface ShowEvent {
  id: string; title: string; venue: string; city: string; url: string; when: string; date: string;
  tags: string[]; price: string; age: string; orgs: string; origin: "19hz";
}
export const REGIONS = { bayarea: "BayArea", seattle: "Seattle", losangeles: "LosAngeles" } as const;
export type RegionKey = keyof typeof REGIONS;
export const regionUrl = (r: RegionKey): string => `https://19hz.info/eventlisting_${REGIONS[r]}.php`;

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string): string => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === "#") { const n = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const text = (html: string): string => decode(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
/** Only http(s) links survive; anything else (javascript:, data:) is dropped. */
const safeUrl = (u: string | undefined): string => { try { const p = new URL(decode(u ?? "")); return p.protocol === "https:" || p.protocol === "http:" ? p.href : ""; } catch { return ""; } };
const hash = (s: string): string => { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };

export function parseListing(html: string): ShowEvent[] {
  const out: ShowEvent[] = [];
  const body = html.slice(Math.max(0, html.search(/<tbody/i)));
  for (const row of body.split(/<tr\b[^>]*>/i).slice(1)) {
    const cells = row.split(/<td\b[^>]*>/i).slice(1);
    if (cells.length < 4) continue;
    const date = /(\d{4})\/(\d{2})\/(\d{2})\s*$/.exec(text(cells.at(-1)!))?.slice(1, 4).join("-");
    if (!date) continue;
    const href = /<a\b[^>]*href=['"]([^'"]+)['"]/i.exec(cells[1] ?? "")?.[1];
    const head = text(cells[1] ?? "");
    const at = head.indexOf(" @ ");
    const title = (at < 0 ? head : head.slice(0, at)).trim();
    let venue = at < 0 ? "" : head.slice(at + 3).trim();
    let city = "";
    const m = /^(.*)\(([^()]*)\)\s*$/.exec(venue);
    if (m) { venue = m[1]!.trim(); city = m[2]!.trim(); }
    if (!title) continue;
    const pa = text(cells[3] ?? "").split("|").map((s) => s.trim());
    out.push({
      id: hash(`${date}|${title}|${venue}`), title, venue, city, url: safeUrl(href), when: text(cells[0] ?? "").replace(/\s*\(/, " ("), date,
      tags: text(cells[2] ?? "").split(",").map((s) => s.trim()).filter(Boolean), price: pa[0] ?? "", age: pa[1] ?? "", orgs: text(cells[4] ?? ""), origin: "19hz",
    });
  }
  return out;
}
