/** Search box: saved places, Michelin names and the area gazetteer, all in the browser. No address search, no third-party service. */
import { fold } from "../data/geo";
import { shardForQuery } from "../data/michelin";
import { buildAreaIndex, buildPlaceIndex, searchAreas, searchMichelin, searchPlaces } from "../search";
import type { AreaIndexRow, AreaRow, Hit, MichelinRow, PlaceIndexRow } from "../search";
import type { App } from "./app";
import { $, $$, esc, icon } from "./store";
import { catOf } from "./ui";

export function initSearch(app: App): void {
  const q = $<HTMLInputElement>("#q"), box = $("#sugg"), wrap = q.closest(".search")!;
  let areas: AreaIndexRow[] | null = null, loading: Promise<void> | null = null;
  let pIdx: PlaceIndexRow[] = [], pCount = -1;
  const shards = new Map<number, MichelinRow[]>();
  let hits: Hit[] = [], active = -1, seq = 0, timer = 0;

  const loadAreas = () => (loading ??= fetch(app.cfg.manifest.areas).then((r) => r.json()).then((rows: AreaRow[]) => { areas = buildAreaIndex(rows); }).catch(() => { loading = null; }));
  async function shard(token: string): Promise<MichelinRow[]> {
    const n = shardForQuery(token);
    if (n === null) return [];
    const hit = shards.get(n);
    if (hit) return hit;
    const rows = (await fetch(`/search/mn-${String(n).padStart(2, "0")}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => [])) as MichelinRow[];
    shards.set(n, rows);
    return rows;
  }
  function setOpen(on: boolean): void {
    box.classList.toggle("on", on);
    q.setAttribute("aria-expanded", String(on));
    if (!on) q.removeAttribute("aria-activedescendant");
  }

  async function run(): Promise<void> {
    const text = q.value.trim(), my = ++seq;
    wrap.classList.toggle("has", text.length > 0);
    if (text.length < 2) { setOpen(false); return; }
    await loadAreas();
    if (pCount !== app.places.length) { pIdx = buildPlaceIndex(app.places); pCount = app.places.length; }
    const toks = fold(text).split(" ").filter((t) => t.length >= 3).sort((a, b) => b.length - a.length);
    const rows = toks.length ? await shard(toks[0]!) : [];
    if (my !== seq) return;
    const saved = searchPlaces(pIdx, text, 6);
    const mich = searchMichelin(rows, text, 4).filter((m) => !saved.some((s) => fold(s.name) === fold(m.name)));
    const place = areas ? searchAreas(areas, text, 5) : [];
    hits = [...saved, ...mich, ...place];
    active = hits.length ? 0 : -1;
    render(saved.length + mich.length, place.length);
    setOpen(true);
  }
  function render(first: number, second: number): void {
    const item = (h: Hit, i: number): string => {
      const cat = h.kind === "place" ? catOf(app.cfg, h.c) : null;
      const ico = h.kind === "place" ? `<span class="ico sm g-${cat!.group}">${icon(cat!.icon)}</span>` : h.kind === "michelin" ? `<span class="ico sm g-mich">${icon("u-award")}</span>` : `<span class="ico sm g-sights">${icon("u-area")}</span>`;
      const sub = h.kind === "place" ? [cat!.label, h.s === "o" ? "Other list" : ""].filter(Boolean).join(" · ") : h.sub;
      return `<button class="sg" role="option" id="sg${i}" aria-selected="${i === active}" data-i="${i}" type="button">${ico}<span class="sgt"><b>${esc(h.name)}</b><span>${esc(sub)}</span></span><span class="go">${icon("u-chev-r")}</span></button>`;
    };
    let html = "";
    if (first) html += `<div class="sgl" role="presentation">Saved places and Michelin</div>` + hits.slice(0, first).map((h, i) => item(h, i)).join("");
    if (second) html += `<div class="sgl" role="presentation">Cities, neighborhoods and ZIP codes</div>` + hits.slice(first).map((h, i) => item(h, i + first)).join("");
    if (!hits.length) html = `<div class="sg-empty">No saved place, Michelin restaurant or area matches. Try a city, neighborhood or ZIP code. Street addresses are not searched.</div>`;
    const credits = [hits.some((h) => h.kind === "area") ? "Areas: GeoNames and US Census." : "", hits.some((h) => h.kind === "michelin") ? "Michelin data: Michelin Guide." : ""].filter(Boolean);
    if (credits.length) html += `<div class="sg-attr">${esc(credits.join(" "))}</div>`;
    box.innerHTML = html;
  }
  function choose(h: Hit | undefined): void {
    if (!h) return;
    setOpen(false);
    q.blur();
    if (h.kind === "place") { const p = app.byId.get(h.id); if (p) app.focusPlace(p); return; }
    if (h.kind === "michelin") { window.dispatchEvent(new CustomEvent("tb:michelin", { detail: { id: h.id, name: h.name, x: h.x, y: h.y, best: h.best, yr: 0 } })); return; }
    app.focusPoint(h.x, h.y, h.area === "city" ? 12.2 : h.area === "zip" ? 13.4 : 14);
    app.ctl?.setSearchPin(h.x, h.y);
    const spin = $("#spin");
    spin.innerHTML = `${icon("u-pin")}<span>${esc(h.name)}</span><button data-act="spinX" aria-label="Remove the search pin" type="button">${icon("u-close")}</button>`;
    spin.classList.add("on");
  }
  const move = (d: number): void => {
    if (!hits.length) return;
    active = (active + d + hits.length) % hits.length;
    $$(".sg", box).forEach((b, i) => b.setAttribute("aria-selected", String(i === active)));
    q.setAttribute("aria-activedescendant", `sg${active}`);
    $(`#sg${active}`)?.scrollIntoView({ block: "nearest" });
  };
  q.addEventListener("focus", () => { void loadAreas(); });
  q.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(() => void run(), 120); wrap.classList.toggle("has", q.value.length > 0); });
  q.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); choose(hits[active]); }
    else if (e.key === "Escape" && box.classList.contains("on")) { setOpen(false); e.stopPropagation(); }
  });
  box.addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLElement>(".sg"); if (b) choose(hits[Number(b.dataset.i)]); });
  document.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest("[data-act=spinX]")) { app.ctl?.clearSearchPin(); $("#spin").classList.remove("on"); }
    if (!t.closest(".search, .sugg")) setOpen(false);
  });
}
