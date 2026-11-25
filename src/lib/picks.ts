/** Picks (hearts): ids saved in the browser; the share link carries the ids, the text export lists names. Pure. */
const ID = /^[0-9a-z]{1,16}$/;
export const MAX_PICKS = 500;
export const cleanIds = (ids: unknown[]): string[] => [...new Set(ids.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(0, MAX_PICKS);
/** "a,b,c" for a URL fragment. */
export const encodePicks = (ids: string[]): string => cleanIds(ids).join(",");
/** Accepts a fragment ("#picks=a,b"), a query string or the bare list. Unknown junk is ignored, never thrown on. */
export function decodePicks(input: string): string[] {
  const m = /(?:^|[#?&])picks=([^&#]*)/.exec(input);
  const raw = m ? m[1]! : input.replace(/^[#?]/, "");
  let s = raw; try { s = decodeURIComponent(raw); } catch { /* keep raw */ }
  return cleanIds(s.split(/[,\s]+/));
}
export const shareUrl = (origin: string, ids: string[]): string => `${origin.replace(/\/$/, "")}/#picks=${encodePicks(ids)}`;
export interface PickRow { name: string; category: string; area: string; maps: string }
export function picksText(rows: PickRow[], link: string): string {
  const lines = rows.map((r) => `- ${r.name}${r.category || r.area ? ` (${[r.category, r.area].filter(Boolean).join(", ")})` : ""}${r.maps ? ` ${r.maps}` : ""}`);
  return `My picks from Little Travel Book:\n${lines.join("\n")}\n\nOpen them on the map: ${link}`;
}
/** Area label for a row: the city part of "street, City, ST zip". */
export function cityOf(addr: string): string {
  const parts = addr.split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length >= 3 ? parts.at(-2)! : parts.length === 2 ? parts[0]! : "";
}
