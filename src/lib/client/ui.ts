/** HTML templates for rows, the peek card and the modal sheets. Pure string builders (escaped), no DOM access except where noted. */
import { fmtDistance } from "../data/geo";
import { AWARD_KIND, AWARD_LABEL, parseAwards } from "../data/michelin";
import type { AwardCode } from "../data/michelin";
import { cityOf } from "../picks";
import type { Cat, Config, Place } from "./store";
import { esc, icon, isNew } from "./store";

export const AWARD_HEX: Record<string, string> = { star: "--michelin", bib: "--aw-bib", green: "--aw-green", sel: "--aw-sel" };
export const catOf = (cfg: Config, id: string): Cat & { group: string } => (cfg.categories.categories.find((c) => c.id === id) ?? { ...cfg.categories.uncategorized, group: "other" }) as Cat & { group: string };

export const awardBadge = (mich: string | undefined, edition: number): string => {
  if (!mich) return "";
  const aw = parseAwards(mich);
  if (!aw.length) return "";
  const best = aw.reduce((a, b) => (rankOf(b.code) > rankOf(a.code) || (rankOf(b.code) === rankOf(a.code) && b.year > a.year) ? b : a));
  const yr = aw.some((a) => a.year === edition) ? edition : best.year;
  return `<span class="bd bd-mich">${icon("u-award")}${esc(AWARD_LABEL[best.code])} ${yr}</span>`;
};
const rankOf = (c: AwardCode): number => ({ S3: 6, S2: 5, S1: 4, B: 3, G: 2, L: 1 })[c];
export const kindOf = (c: AwardCode) => AWARD_KIND[c];

/** A subtle mark for another branch of a saved chain; the long wording is for assistive tech and the tooltip only. */
export function exMark(p: Place): string {
  if (!p.ex) return "";
  const l = `Another location of ${p.n}${p.br ? `, ${p.br}` : ""}`;
  return `<span class="bd-more" role="img" aria-label="${esc(l)}" title="${esc(l)}">${icon("u-pin")}</span>`;
}

export function badges(p: Place, edition: number, picked: boolean, withEx = true): string {
  const b: string[] = [];
  if (withEx) { const m = exMark(p); if (m) b.push(`<span class="bd">${m}</span>`); }
  if (p.been) b.push(`<span class="bd bd-been">${icon("u-check")}Been</span>`);
  if (isNew(p.added)) b.push(`<span class="bd bd-new">New</span>`);
  if (p.live) b.push(`<span class="bd bd-pick">Zach's pick</span>`);
  const m = awardBadge(p.mich, edition);
  if (m) b.push(m);
  if (picked) { /* hearted is shown by the heart itself */ }
  return b.length ? `<span class="rb">${b.join("")}</span>` : "";
}

/** `showSrc`: tag Other-list places, only worth saying while both sources are on screen. */
export function rowHtml(cfg: Config, p: Place, dist: number | null, picked: boolean, edition: number, showSrc = false): string {
  const cat = catOf(cfg, p.c);
  const area = cityOf(p.addr);
  const meta = [cat.label, area].filter(Boolean).join(" · ");
  return `<div class="row" data-id="${esc(p.id)}"><button class="rmain" data-act="open" data-id="${esc(p.id)}" type="button"><span class="ico g-${cat.group}">${icon(cat.icon)}</span><span class="rtx"><span class="rn">${esc(p.n)}</span><span class="rm">${exMark(p)}${esc(meta)}${showSrc && p.s === "o" ? '<span class="tag">Other list</span>' : ""}</span>${p.note ? `<span class="rq">${esc(p.note)}</span>` : ""}${badges(p, edition, picked, false)}</span>${dist === null ? "" : `<span class="dst">${esc(fmtDistance(dist))}</span>`}</button>${heartBtn(p, picked)}</div>`;
}
export const heartBtn = (p: Place, picked: boolean): string => `<button class="heart" data-act="heart" data-id="${esc(p.id)}" aria-pressed="${picked}" aria-label="${picked ? "Remove" : "Save"} ${esc(p.n)} ${picked ? "from" : "to"} my picks" type="button">${icon("u-heart")}<i></i><i></i><i></i></button>`;

/** Peek card body for one place. `open` shows the full detail (address, lists, Michelin years). */
export function peekHtml(cfg: Config, p: Place, dist: number | null, picked: boolean, edition: number, idx: number, total: number, open: boolean): string {
  const cat = catOf(cfg, p.c);
  const listNames = p.l.map((id) => cfg.manifest.lists.find((l) => l.id === id)?.name ?? id);
  const aw = p.mich ? parseAwards(p.mich) : [];
  const detail = open ? `${p.addr ? `<p class="pk-addr">${esc(p.addr)}</p>` : ""}<p class="pk-addr">On: ${esc(listNames.join(", "))}</p>${aw.length ? `<div class="pk-mi"><small>${icon("u-award")}Michelin Guide</small>${aw.slice().sort((a, b) => b.year - a.year).map((a) => `<span>${a.year}<em>${esc(AWARD_LABEL[a.code])}</em></span>`).join("")}</div>` : ""}` : "";
  return `<div class="pk"><div class="pk-top"><span class="ico lg g-${cat.group}">${icon(cat.icon)}</span><div class="pk-t"><h2>${esc(p.n)}</h2><p class="pk-cat">${esc([cat.label, cityOf(p.addr), dist === null ? "" : fmtDistance(dist)].filter(Boolean).join(" · "))}</p></div><button class="pk-x" data-act="peekX" aria-label="Close" type="button">${icon("u-close")}</button></div>
${p.note ? `<div class="pk-note"><small>Zach's note</small>${esc(p.note)}</div>` : ""}${badges(p, edition, picked)}${detail}
<div class="pk-act"><button class="hbtn" data-act="heart" data-id="${esc(p.id)}" aria-pressed="${picked}" type="button">${icon("u-heart")}${picked ? "In my picks" : "Add to picks"}<i></i><i></i><i></i></button><button class="mapsbtn" data-act="peekMore" aria-expanded="${open}" aria-label="${open ? "Fewer details" : "More details"}" type="button">${icon("u-info")}</button>${p.maps ? `<a class="mapsbtn" href="${esc(p.maps)}" target="_blank" rel="noopener" aria-label="Open ${esc(p.n)} in Google Maps">${icon("u-ext")}</a>` : ""}</div>
${total > 1 ? `<div class="pk-nav"><button data-act="peekPrev" aria-label="Previous nearby place" type="button" ${idx <= 0 ? "disabled" : ""}>${icon("u-chev-l")}</button><span>${idx + 1} of ${total} nearby</span><button data-act="peekNext" aria-label="Next nearby place" type="button" ${idx >= total - 1 ? "disabled" : ""}>${icon("u-chev-r")}</button></div>` : ""}</div>`;
}

export function michelinPeekHtml(name: string, best: AwardCode | null, city: string, awards: string, url: string): string {
  const aw = awards ? parseAwards(awards) : [];
  return `<div class="pk"><div class="pk-top"><span class="ico lg g-mich ringico" style="--rc:var(${AWARD_HEX[best ? AWARD_KIND[best] : "sel"]})">${icon("u-award")}</span><div class="pk-t"><h2>${esc(name)}</h2><p class="pk-cat">Michelin Guide${city ? ` · ${esc(city)}` : ""}</p></div><button class="pk-x" data-act="peekX" aria-label="Close" type="button">${icon("u-close")}</button></div>
${aw.length ? `<div class="pk-mi"><small>${icon("u-award")}Distinctions by year</small>${aw.slice().sort((a, b) => b.year - a.year).map((a) => `<span>${a.year}<em>${esc(AWARD_LABEL[a.code])}</em></span>`).join("")}</div>` : `<div class="pk-note">Loading distinctions…</div>`}
<div class="pk-act">${url ? `<a class="hbtn linkbtn" href="https://guide.michelin.com/${esc(url)}" target="_blank" rel="noopener">${icon("u-ext")}Michelin Guide page</a>` : ""}</div></div>`;
}

export function sheetHead(title: string, extra = ""): string {
  return `<div class="shead2"><h2>${esc(title)}</h2>${extra}<button class="ibtn" data-act="closeSheet" aria-label="Close" type="button">${icon("u-close")}</button></div>`;
}
