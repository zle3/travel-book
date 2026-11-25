/** Explorer controller: state, feed, filters, picks, peek, sheets and the glue between the map and the DOM. */
import { distanceM } from "../data/geo";
import { activeCount, defaultFilters, matches, toggleCats, toggleIn } from "../filters";
import type { AwardKind, Filters } from "../filters";
import { METROS, metroOf } from "../data/metros";
import { parseAwards } from "../data/michelin";
import type { AwardCode } from "../data/michelin";
import { cleanIds, decodePicks, picksText, shareUrl, cityOf } from "../picks";
import { QUICK } from "../quick";
import type { MapController, MichelinPoint } from "./map";
import { initSheet } from "./sheet";
import type { SheetCtl, Snap } from "./sheet";
import { $, $$, SF_VIEW, denseDismissed, dismissDense, esc, icon, isDesktop, loadFilters, loadPicks, loadSort, loadView, reducedMotion, saveFilters, savePicks, saveSort, saveView, setTheme, theme, toast } from "./store";
import type { Config, Place, Sort, View } from "./store";
import { AWARD_HEX, catOf, heartBtn, michelinPeekHtml, peekHtml, rowHtml, sheetHead } from "./ui";

export interface App {
  cfg: Config; places: Place[]; byId: Map<string, Place>; filters: Filters; picks: string[]; shared: string[];
  user: { lng: number; lat: number; acc: number } | null; view: View; bounds: [number, number, number, number]; ctl: MapController | null;
  backendUp: boolean | null;
  focusPoint(lng: number, lat: number, zoom: number): void;
  focusPlace(p: Place): void;
  openSheet(id: string): void; closeSheet(): void; refresh(): void; showTab(t: "places" | "shows" | "picks"): void;
  addLive(places: Place[]): void; setBackend(up: boolean): void;
  sheetPad(): { top?: number; bottom?: number; left?: number; right?: number };
}

const FEED_CHUNK = 40;
/** Non-critical notices (dense hint, offline pill) wait for the page to settle so they never compete with the first paint (LCP). */
let settled = false;
const settledP = new Promise<void>((r) => setTimeout(() => { settled = true; r(); }, 6000));
const whenSettled = (f: () => void): void => { if (settled) f(); else void settledP.then(f); };

export async function start(): Promise<void> {
  const cfg = JSON.parse($("#tb-config").textContent ?? "{}") as Config;
  const root = document.documentElement;
  const mq = matchMedia("(min-width: 900px)");
  const syncDevice = () => { root.classList.toggle("desktop", mq.matches); root.classList.toggle("phone", !mq.matches); };
  mq.addEventListener("change", () => { syncDevice(); layoutSheet(); });

  const app: App = {
    cfg, places: [], byId: new Map(), filters: loadFilters(), picks: loadPicks(), shared: [], user: null,
    view: loadView() ?? SF_VIEW, bounds: [-180, -85, 180, 85], ctl: null, backendUp: null,
    focusPoint: () => {}, focusPlace: () => {}, openSheet: () => {}, closeSheet: () => {}, refresh: () => {}, showTab: () => {}, addLive: () => {}, setBackend: () => {}, sheetPad: () => ({}),
  };
  let sort: Sort = loadSort();
  let sheetCtl: SheetCtl | null = null;
  let feedLimit = FEED_CHUNK;
  let ordered: { p: Place; d: number }[] = [];
  let selected: { kind: "place"; id: string } | { kind: "mich"; m: MichelinPoint } | null = null;
  let nearby: Place[] = [];
  let peekOpen = false;
  let stopPulse: (() => void) | null = null;
  const edition = cfg.manifest.currentEdition;
  const picked = (id: string) => app.picks.includes(id) || app.shared.includes(id);
  const hearted = () => new Set([...app.picks, ...app.shared]);

  // ---------- data
  const geo = (await fetch(cfg.manifest.places).then((r) => r.json())) as { features: { geometry: { coordinates: [number, number] }; properties: Record<string, unknown> }[] };
  app.places = geo.features.map((f) => { const p = f.properties as Record<string, unknown>; return { id: String(p.id), n: String(p.n), c: String(p.c), s: p.s === "m" ? "m" : "o", l: (p.l as string[]) ?? [], note: String(p.note ?? ""), addr: String(p.addr ?? ""), maps: String(p.maps ?? ""), x: f.geometry.coordinates[0], y: f.geometry.coordinates[1], mich: p.mich ? String(p.mich) : undefined, ex: p.ex ? 1 : undefined, br: p.br ? String(p.br) : undefined } as Place; });
  app.byId = new Map(app.places.map((p) => [p.id, p]));
  const hash = location.hash;
  if (/picks=/.test(hash)) {
    app.shared = cleanIds(decodePicks(hash)).filter((id) => app.byId.has(id));
    history.replaceState(null, "", location.pathname + location.search);
  }

  // ---------- derived lists
  const ctx = { currentEdition: edition };
  const filtered = (): Place[] => app.places.filter((p) => matches(p, app.filters, ctx));
  const origin = (): { x: number; y: number } => (app.user ? { x: app.user.lng, y: app.user.lat } : { x: app.view.lng, y: app.view.lat });
  const inBounds = (p: Place) => p.x >= app.bounds[0] && p.x <= app.bounds[2] && p.y >= app.bounds[1] && p.y <= app.bounds[3];

  function recompute(): void {
    const o = origin();
    const list = filtered().filter((p) => (app.ctl ? inBounds(p) : true)).map((p) => ({ p, d: distanceM(o.x, o.y, p.x, p.y) }));
    list.sort((a, b) => a.d - b.d);
    if (sort === "az") list.sort((a, b) => a.p.n.localeCompare(b.p.n));
    else if (sort === "mix") { const m = list.filter((r) => r.p.s === "m"), t = list.filter((r) => r.p.s !== "m"); const out: typeof list = []; for (let i = 0; i < Math.max(m.length, t.length); i++) { if (m[i]) out.push(m[i]!); if (t[i]) out.push(t[i]!); } list.splice(0, list.length, ...out); }
    ordered = list;
  }

  // ---------- rendering
  const body = $("#listBody");
  function renderFeed(reset = true): void {
    if (reset) feedLimit = FEED_CHUNK;
    const slice = ordered.slice(0, feedLimit);
    const distOn = !!app.ctl || true;
    body.innerHTML = slice.length
      ? slice.map((r) => rowHtml(cfg, r.p, distOn ? r.d : null, picked(r.p.id), edition)).join("") + (ordered.length > feedLimit ? `<div class="endnote" id="feedEnd">Showing ${feedLimit} of ${ordered.length}. Keep scrolling for more.</div>` : `<div class="endnote">That is everything in view.</div>`) + `<div class="hid"></div>`
      : `<div class="empty"><b>Nothing here with these filters.</b>Zoom out, move the map, or clear a filter.<button class="btn" data-act="clearF" type="button">Clear filters</button></div><div class="hid"></div>`;
    const cnt = $("[data-cnt]");
    cnt.textContent = app.ctl ? `${ordered.length.toLocaleString()} ${ordered.length === 1 ? "place" : "places"} in this area` : `${ordered.length.toLocaleString()} places`;
    $("#hello").textContent = app.user ? "Sorted by distance from you." : sort === "az" ? "Places in view, A to Z." : "Places in view, nearest to the middle of the map first.";
    $("[data-sort]").textContent = sort === "near" ? "Nearest" : sort === "mix" ? "Mix" : "A-Z";
    const io = $("#feedEnd");
    if (io && "IntersectionObserver" in window) new IntersectionObserver((es, ob) => { if (es[0]?.isIntersecting) { ob.disconnect(); feedLimit += FEED_CHUNK; renderFeed(false); } }, { root: body.closest(".sheet") === null ? null : body, rootMargin: "200px" }).observe(io);
    $$("[data-fcount]").forEach((b) => { const n = activeCount(app.filters); b.textContent = String(n); b.hidden = n === 0; });
    renderChips();
    denseHint();
    topH();
  }

  function renderChips(): void {
    for (const q of QUICK) { if (q.shows) continue; const el = $<HTMLButtonElement>(`[data-chip="${q.id}"]`); el?.setAttribute("aria-pressed", String(q.cats.every((c) => app.filters.cats.includes(c)))); }
    const f = app.filters;
    const n = activeCount(f);
    // The clear button always has its slot (hidden when nothing is active), so toggling a chip never moves the row.
    $("#qr1").innerHTML = `<button class="chip clr" data-act="clearF" aria-label="${n ? `Clear ${n} active filters` : "No filters to clear"}" type="button"${n ? "" : " disabled"}>${icon("u-close")}</button><div class="srcseg" role="group" aria-label="Sources"><button data-act="src" data-src="mine" aria-pressed="${f.mine}" type="button">${icon("u-pin")}My lists</button><button data-act="src" data-src="other" aria-pressed="${f.other}" type="button">${icon("c-other")}Other lists</button><button data-act="src" data-src="mich" data-michelin aria-pressed="${f.michelinLayer}" type="button">${icon("u-award")}Michelin</button></div>${cfg.manifest.hasBeen ? `<button class="chip q-been" data-act="been" aria-pressed="${f.hideBeen}" type="button">${icon("u-eye-off")}Hide been</button>` : ""}`;
    for (const k of ["star", "bib"] as AwardKind[]) $("#qr2").querySelector(`[data-mich="${k}"]`)?.setAttribute("aria-pressed", String(f.mich.includes(k)));
  }
  // Michelin chips live at the end of the scrolling row.
  $("#qr2").insertAdjacentHTML("beforeend", `<button class="chip g-mich" data-act="mich" data-mich="star" aria-pressed="false" type="button"><span class="ico sm ringico" style="--rc:var(--michelin)">${icon("u-award")}</span>Stars</button><button class="chip g-mich" data-act="mich" data-mich="bib" aria-pressed="false" type="button"><span class="ico sm ringico" style="--rc:var(--aw-bib)">${icon("u-award")}</span>Bib Gourmand</button>`);

  function denseHint(): void {
    const on = !denseDismissed() && app.view.zoom < 14 && app.view.zoom > 9 && ordered.length > 250;
    whenSettled(() => $("#dense").classList.toggle("on", on && !denseDismissed()));
  }

  function pushMap(): void {
    if (!app.ctl) return;
    app.ctl.setPlaces(filtered(), hearted());
    app.ctl.setMichelin(app.filters.michelinLayer, app.filters.mich, !app.filters.anyYear, edition);
  }
  function pills(): void {
    const n = app.picks.length;
    $$("[data-picks-pill]").forEach((p) => { if (p.textContent !== String(n)) { p.textContent = String(n); p.classList.toggle("on", n > 0); const c = p.closest(".counter") ?? p; c.classList.remove("bump"); void (c as HTMLElement).offsetWidth; c.classList.add("bump"); } });
  }
  app.refresh = () => { saveFilters(app.filters); recompute(); renderFeed(); pushMap(); pills(); };

  // ---------- layout: sheet, panel padding
  const sheet = $("#sheet");
  function sheetPad(): { top?: number; bottom?: number; left?: number; right?: number } {
    if (isDesktop()) return { left: 440 };
    return { bottom: sheetCtl && sheetCtl.current() !== "full" ? Math.min(sheetCtl.visible(), innerHeight * 0.5) : 0, top: 130 };
  }
  app.sheetPad = sheetPad;
  function layoutSheet(): void {
    if (isDesktop()) { sheet.style.transform = ""; sheet.classList.remove("full"); root.classList.remove("fullmode"); app.ctl?.setPad(sheetPad()); return; }
    sheetCtl ??= initSheet(sheet, { handles: [$("#grab"), $(".shead", sheet), $(".crow", sheet), $("#hello")], list: $("#listBody") }, (s: Snap) => { $$("[data-seg]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.seg === "list") === (s === "full")))); app.ctl?.setPad(sheetPad()); });
    sheetCtl.snap(sheetCtl.current(), false);
  }
  const topH = () => { const t = $("#top"); const h = Math.round(t.getBoundingClientRect().height); document.documentElement.style.setProperty("--topH", `${h}px`); };

  // ---------- peek
  const peek = $("#peek"), track = $("#pkTrack");
  function showPeek(): void {
    if (!selected) { peek.classList.remove("on"); peek.setAttribute("aria-hidden", "true"); app.ctl?.select(null); return; }
    if (selected.kind === "place") {
      const p = app.byId.get(selected.id)!;
      const o = origin();
      const idx = nearby.findIndex((x) => x.id === p.id);
      track.innerHTML = peekHtml(cfg, p, distanceM(o.x, o.y, p.x, p.y), picked(p.id), edition, idx, nearby.length, peekOpen);
      app.ctl?.select(p.id);
    }
    peek.classList.add("on"); peek.setAttribute("aria-hidden", "false");
  }
  function setNearby(p: Place): void {
    nearby = filtered().map((q) => ({ q, d: distanceM(p.x, p.y, q.x, q.y) })).sort((a, b) => a.d - b.d).slice(0, 8).map((r) => r.q);
    if (!nearby.some((q) => q.id === p.id)) nearby.unshift(p);
    else { nearby = [p, ...nearby.filter((q) => q.id !== p.id)]; }
  }
  app.focusPlace = (p) => {
    selected = { kind: "place", id: p.id }; peekOpen = false; setNearby(p); showPeek();
    sheetCtl?.snap("peek");
    app.ctl?.flyTo(p.x, p.y, Math.max(app.view.zoom, 15), sheetPad());
  };
  app.focusPoint = (lng, lat, zoom) => app.ctl?.flyTo(lng, lat, zoom, sheetPad());
  async function showMichelin(m: MichelinPoint): Promise<void> {
    selected = { kind: "mich", m }; sheetCtl?.snap("peek");
    track.innerHTML = michelinPeekHtml(m.name || "Michelin restaurant", null, "", "", "");
    peek.classList.add("on"); peek.setAttribute("aria-hidden", "false");
    app.ctl?.flyTo(m.x, m.y, Math.max(app.view.zoom, 13.5), sheetPad());
    try {
      const d = (await fetch(`/michelin/d/${m.id.slice(0, 2)}.json`).then((r) => r.json())) as Record<string, { n: string; c: string; k: string; a: string; u: string }>;
      const r = d[m.id];
      if (r && selected?.kind === "mich" && selected.m.id === m.id) {
        const best = parseAwards(r.a).reduce<AwardCode | null>((a, b) => (!a || ({ S3: 6, S2: 5, S1: 4, B: 3, G: 2, L: 1 } as Record<string, number>)[b.code]! > ({ S3: 6, S2: 5, S1: 4, B: 3, G: 2, L: 1 } as Record<string, number>)[a]! ? b.code : a), null);
        track.innerHTML = michelinPeekHtml(r.n, best, [r.c, r.k].filter(Boolean).join(", "), r.a, r.u);
      }
    } catch { /* details are optional */ }
  }
  function closePeek(): void { selected = null; showPeek(); }
  window.addEventListener("tb:michelin", (e) => void showMichelin((e as CustomEvent<MichelinPoint>).detail));

  // ---------- modal sheets
  let openId: string | null = null, opener: HTMLElement | null = null;
  const msheets = ["filtersSheet", "picksSheet", "legendSheet", "weatherSheet"];
  app.openSheet = (id: string) => {
    if (openId) closeSheetNow(false);
    opener = document.activeElement as HTMLElement | null;
    openId = id;
    renderSheet(id);
    const el = $(`#${id}`);
    el.classList.add("on"); el.setAttribute("aria-hidden", "false"); $("#scrim").classList.add("on");
    el.focus({ preventScroll: true });
  };
  function closeSheetNow(restore = true): void {
    if (!openId) return;
    const el = $(`#${openId}`);
    el.classList.remove("on"); el.setAttribute("aria-hidden", "true"); $("#scrim").classList.remove("on");
    openId = null;
    if (restore) opener?.focus?.({ preventScroll: true });
  }
  app.closeSheet = () => closeSheetNow();
  function renderSheet(id: string): void {
    if (id === "filtersSheet") $("#filtersHost").innerHTML = filtersHtml();
    else if (id === "picksSheet") $("#picksHost").innerHTML = picksHtml();
    else if (id === "legendSheet") $("#legendHost").innerHTML = legendHtml();
  }
  const rerenderOpen = () => { if (openId) { const sc = $(`#${openId} .fbody, #${openId} .pkbody`)?.scrollTop ?? 0; renderSheet(openId); const b = $(`#${openId} .fbody, #${openId} .pkbody`); if (b) b.scrollTop = sc; } };

  function filtersHtml(): string {
    const f = app.filters, g = cfg.categories.groups;
    const chip = (c: string, on: boolean, group: string, ic: string, label: string) => `<button class="chip" data-act="cat" data-cat="${c}" aria-pressed="${on}" type="button"><span class="ico sm g-${group}">${icon(ic)}</span>${esc(label)}</button>`;
    const groupsHtml = g.map((gr) => { const cs = cfg.categories.categories.filter((c) => c.group === gr.id); const all = cs.every((c) => f.cats.includes(c.id)); return `<div class="lgh"><span>${esc(gr.label)}</span><button class="link" data-act="grp" data-grp="${gr.id}" type="button">${all ? "Clear group" : "Select group"}</button></div><div class="cw">${cs.map((c) => chip(c.id, f.cats.includes(c.id), c.group, c.icon, c.label)).join("")}</div>`; }).join("");
    const lists = (src: "m" | "o") => cfg.manifest.lists.filter((l) => l.source === src).map((l) => { const cat = cfg.categories.categories.find((c) => c.id === l.id); return `<label class="lrow"><input type="checkbox" data-act="list" data-list="${l.id}" ${f.offLists.includes(l.id) ? "" : "checked"} /><span class="cb">${icon("u-check")}</span>${cat ? `<span class="g-${cat.group}">${icon(cat.icon, "k")}</span>` : `<span class="g-other">${icon("c-other", "k")}</span>`}<span class="nm">${esc(l.name)}</span><em>${l.count}</em></label>`; }).join("");
    const kinds: [AwardKind, string][] = [["star", "Stars"], ["bib", "Bib Gourmand"], ["green", "Green Star"], ["sel", "Selected"]];
    const regions: [string, string][] = [...METROS.map((m) => [m.id, m.name] as [string, string]), ["other", "Elsewhere"]];
    const n = filtered().length;
    return `${sheetHead("Filters", `<button class="link" data-act="clearF" type="button">Clear</button>`)}<div class="fbody">
<h3>Show</h3><div class="tri"><button data-act="src" data-src="mine" aria-pressed="${f.mine}" type="button">${icon("u-pin")}My lists</button><button data-act="src" data-src="other" aria-pressed="${f.other}" type="button">${icon("c-other")}Other lists</button><button data-act="src" data-src="mich" aria-pressed="${f.michelinLayer}" type="button">${icon("u-award")}Michelin</button></div>
<p class="hint">Michelin adds every Michelin restaurant worldwide (2022 to ${edition}) as its own layer on the map. Other lists are saved by other people, not friends' picks.</p>
<h3>Michelin distinctions</h3><div class="cw">${kinds.map(([k, l]) => `<button class="chip g-mich" data-act="mich" data-mich="${k}" aria-pressed="${f.mich.includes(k)}" type="button"><span class="ico sm ringico" style="--rc:var(${AWARD_HEX[k]})">${icon("u-award")}</span>${l}</button>`).join("")}</div>
<label class="sw"><span class="nm">Any year (2022 to ${edition})<small class="hint2">Off: only the ${edition} edition</small></span><input type="checkbox" data-act="anyyear" ${f.anyYear ? "checked" : ""} /><span class="tg"></span></label>
<h3>Region</h3><div class="cw">${regions.map(([id, l]) => `<button class="chip" data-act="region" data-region="${id}" aria-pressed="${f.regions.includes(id)}" type="button">${esc(l)}</button>`).join("")}</div>
<h3>Categories</h3>${groupsHtml}
<h3>My lists</h3>${lists("m")}<h3>Other lists</h3>${lists("o")}
${cfg.manifest.hasBeen ? `<label class="sw"><span class="nm">Hide places I have been</span><input type="checkbox" data-act="been" ${f.hideBeen ? "checked" : ""} /><span class="tg"></span></label>` : ""}
<h3>Appearance</h3><label class="sw"><span class="nm">Light theme</span><input type="checkbox" data-act="theme" ${theme() === "light" ? "checked" : ""} /><span class="tg"></span></label></div>
<div class="ffoot"><button class="cta" data-act="closeSheet" type="button">Show ${n.toLocaleString()} places</button></div>`;
  }
  function picksHtml(): string {
    const mine = app.picks.map((id) => app.byId.get(id)).filter(Boolean) as Place[];
    const sh = app.shared.map((id) => app.byId.get(id)).filter((p): p is Place => !!p && !app.picks.includes(p.id));
    const row = (p: Place) => { const cat = catOf(cfg, p.c); return `<div class="pkrow" data-id="${esc(p.id)}"><button class="rmain" data-act="open" data-id="${esc(p.id)}" type="button"><span class="ico g-${cat.group}">${icon(cat.icon)}</span><span class="rtx"><span class="rn">${esc(p.n)}</span><span class="rm">${esc([cat.label, cityOf(p.addr)].filter(Boolean).join(" · "))}</span></span></button>${heartBtn(p, picked(p.id))}</div>`; };
    const empty = `<div class="pkempty"><span class="big">${icon("u-heart")}</span><b>No picks yet</b>Tap the heart on any place to keep it here. Picks stay in this browser until you send them.</div>`;
    return `${sheetHead(`Your picks${mine.length ? ` (${mine.length})` : ""}`)}<div class="pkbody">${sh.length ? `<h3 class="shared-h">Shared with you (${sh.length})</h3>${sh.map(row).join("")}<div class="pkfoot"><button class="btn" data-act="saveShared" type="button">${icon("u-heart")}Save these to my picks</button></div>` : ""}${mine.length ? mine.map(row).join("") : sh.length ? "" : empty}</div>${mine.length ? `<div class="pkfoot"><button class="cta" data-act="sharePicks" type="button">${icon("u-share")}Send me your picks</button><button class="btn" data-act="copyPicks" type="button">${icon("u-copy")}Copy as text</button></div>` : ""}`;
  }
  function legendHtml(): string {
    const gs = cfg.categories.groups.map((g) => `<h3 class="lgh2">${esc(g.label)}</h3>${cfg.categories.categories.filter((c) => c.group === g.id).map((c) => `<div class="it"><span class="disc g-${g.id}">${icon(c.icon)}</span>${esc(c.label)}</div>`).join("")}`).join("");
    const aw = cfg.categories.awards.map((a) => `<div class="it"><span class="disc ring" style="--rc:var(${AWARD_HEX[a.id]})">${icon("u-award")}</span>${esc(a.label)}</div>`).join("");
    return `${sheetHead("Key")}<div class="lg2"><h3 class="lgh2">Pins</h3><div class="it"><span class="disc g-other">${icon("u-heart")}</span>Hearted pins wear a rose heart</div><div class="it"><span class="disc dsm g-other">${icon("c-other")}</span>Dots when zoomed out, icons up close</div>${gs}<h3 class="lgh2">Michelin layer</h3>${aw}</div>`;
  }

  // ---------- picks
  function togglePick(id: string, btn?: HTMLElement): void {
    const was = app.picks.includes(id);
    if (!was && app.shared.includes(id)) app.shared = app.shared.filter((x) => x !== id);
    app.picks = was ? app.picks.filter((x) => x !== id) : [...app.picks, id];
    savePicks(app.picks);
    if (btn && !reducedMotion()) { btn.classList.remove("pop", "unpop"); void btn.offsetWidth; btn.classList.add(was ? "unpop" : "pop"); }
    $$(`[data-act="heart"][data-id="${CSS.escape(id)}"]`).forEach((b) => { b.setAttribute("aria-pressed", String(!was)); const p = app.byId.get(id); if (p) b.setAttribute("aria-label", `${was ? "Save" : "Remove"} ${p.n} ${was ? "to" : "from"} my picks`); if (b.classList.contains("hbtn")) b.lastChild && ((b.childNodes[1] as Text).textContent = was ? "Add to picks" : "In my picks"); });
    pills();
    app.ctl?.setPlaces(filtered(), hearted());
    if (openId === "picksSheet") window.setTimeout(rerenderOpen, reducedMotion() ? 0 : 260);
  }
  const link = () => shareUrl(location.origin, app.picks);
  const picksRows = () => app.picks.flatMap((id) => { const p = app.byId.get(id); return p ? [{ name: p.n, category: catOf(cfg, p.c).label, area: cityOf(p.addr), maps: p.maps }] : []; });

  // ---------- locate me (only on tap; the position stays in memory)
  function locate(): void {
    const btn = $("#locateBtn");
    if (app.user) { app.ctl?.flyTo(app.user.lng, app.user.lat, Math.max(app.view.zoom, 14.5), sheetPad()); return; }
    if (!("geolocation" in navigator)) { locCard("off", "Location is not available", "This browser cannot share a position. Search and panning still work."); return; }
    btn.classList.add("busy"); btn.setAttribute("aria-busy", "true");
    navigator.geolocation.getCurrentPosition((pos) => {
      btn.classList.remove("busy"); btn.removeAttribute("aria-busy"); btn.classList.add("on");
      app.user = { lng: pos.coords.longitude, lat: pos.coords.latitude, acc: pos.coords.accuracy };
      stopPulse?.(); stopPulse = app.ctl?.setUser(app.user.lng, app.user.lat, app.user.acc) ?? null;
      app.ctl?.flyTo(app.user.lng, app.user.lat, 14.5, sheetPad());
      sort = "near"; recompute(); renderFeed();
      toast("Sorted by distance from you");
    }, (err) => {
      btn.classList.remove("busy"); btn.removeAttribute("aria-busy");
      locCard("off", err.code === 1 ? "Location is off" : "Could not find you", err.code === 1 ? "No problem. Search a city or ZIP, or pan the map. Your browser's site settings can turn location on later." : "Try again in a moment, or search for a city or ZIP.");
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }
  function locCard(kind: "off", title: string, text: string): void {
    const c = $("#loccard");
    c.innerHTML = `<span class="lc-i ${kind}">${icon("u-locate")}</span><div class="lc-t"><b>${esc(title)}</b>${esc(text)}</div><button class="ibtn lc-x" data-act="locX" aria-label="Dismiss" type="button">${icon("u-close")}</button>`;
    c.classList.add("on");
  }

  // ---------- tabs
  let tab: "places" | "shows" | "picks" = "places";
  app.showTab = (t) => {
    if (t === "picks") { app.openSheet("picksSheet"); return; }
    tab = t;
    const shows = $("#shows");
    shows.classList.toggle("on", t === "shows"); shows.setAttribute("aria-hidden", String(t !== "shows"));
    $$("#bar [data-tab]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.tab === t)));
    if (t === "shows") window.dispatchEvent(new CustomEvent("tb:shows"));
  };
  app.addLive = (list) => {
    for (const p of list) { if (app.byId.has(p.id)) continue; app.places.push(p); app.byId.set(p.id, p); }
    app.refresh();
  };
  app.setBackend = (up) => { app.backendUp = up; whenSettled(() => $("#offline").classList.toggle("on", app.backendUp === false && !offlineDismissed)); app.ctl?.setHome(up); };
  let offlineDismissed = false;

  // ---------- events
  document.addEventListener("click", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-act]");
    if (!t) { if (!(e.target as Element).closest(".sortmenu, .sortb")) closeSort(); return; }
    const act = t.dataset.act!, id = t.dataset.id ?? "";
    switch (act) {
      case "open": { const p = app.byId.get(id); if (p) { if (openId) closeSheetNow(false); app.focusPlace(p); } break; }
      case "heart": togglePick(id, t); break;
      case "src": { const k = t.dataset.src; if (k === "mine") app.filters.mine = !app.filters.mine; else if (k === "other") app.filters.other = !app.filters.other; else app.filters.michelinLayer = !app.filters.michelinLayer; app.refresh(); rerenderOpen(); break; }
      case "quick": { const q = QUICK.find((x) => x.id === t.dataset.chip); if (q) { const on = q.cats.every((c) => app.filters.cats.includes(c)); app.filters.cats = on ? app.filters.cats.filter((c) => !q.cats.includes(c)) : [...new Set([...app.filters.cats, ...q.cats])]; app.refresh(); rerenderOpen(); } break; }
      case "cat": app.filters.cats = toggleCats(app.filters.cats, [t.dataset.cat!]); app.refresh(); rerenderOpen(); break;
      case "grp": { const ids = cfg.categories.categories.filter((c) => c.group === t.dataset.grp).map((c) => c.id); app.filters.cats = toggleCats(app.filters.cats, ids); app.refresh(); rerenderOpen(); break; }
      case "mich": app.filters.mich = toggleIn(app.filters.mich, t.dataset.mich as AwardKind); app.refresh(); rerenderOpen(); break;
      case "region": app.filters.regions = toggleIn(app.filters.regions, t.dataset.region!); app.refresh(); rerenderOpen(); break;
      case "been": app.filters.hideBeen = !app.filters.hideBeen; app.refresh(); rerenderOpen(); break;
      case "clearF": app.filters = defaultFilters(); app.refresh(); rerenderOpen(); break;
      case "openF": app.openSheet("filtersSheet"); break;
      case "key": app.openSheet("legendSheet"); break;
      case "weather": app.openSheet("weatherSheet"); break;
      case "closeSheet": closeSheetNow(); break;
      case "tab": app.showTab(t.dataset.tab as "places" | "shows" | "picks"); break;
      case "theme": { const next = theme() === "light" ? "dark" : "light"; setTheme(next); break; }
      case "locate": locate(); break;
      case "locX": $("#loccard").classList.remove("on"); break;
      case "offX": offlineDismissed = true; $("#offline").classList.remove("on"); break;
      case "dense": sheetCtl?.snap("peek"); app.ctl?.map.zoomIn(); break;
      case "denseX": dismissDense(); $("#dense").classList.remove("on"); break;
      case "peekX": closePeek(); break;
      case "peekMore": peekOpen = !peekOpen; showPeek(); break;
      case "peekPrev": case "peekNext": { if (selected?.kind !== "place") break; const i = nearby.findIndex((q) => q.id === (selected as { id: string }).id) + (act === "peekNext" ? 1 : -1); const p = nearby[i]; if (p) { selected = { kind: "place", id: p.id }; showPeek(); app.ctl?.flyTo(p.x, p.y, Math.max(app.view.zoom, 15), sheetPad()); } break; }
      case "seg": sheetCtl?.snap(t.dataset.seg === "list" ? "full" : "half"); break;
      case "sort": { const m = $("#sortmenu"); const on = !m.classList.contains("on"); m.classList.toggle("on", on); t.setAttribute("aria-expanded", String(on)); if (on) m.innerHTML = ([["near", "Nearest"], ["mix", "Mix of my lists and others"], ["az", "A to Z"]] as [Sort, string][]).map(([k, l]) => `<button role="menuitemradio" aria-checked="${sort === k}" data-act="sortSet" data-sort-key="${k}" type="button">${l}${icon("u-check")}</button>`).join(""); break; }
      case "sortSet": sort = t.dataset.sortKey as Sort; saveSort(sort); closeSort(); recompute(); renderFeed(); break;
      case "sharePicks": { const url = link(); const text = "My picks from Little Travel Book"; if (navigator.share) navigator.share({ title: text, text, url }).catch(() => {}); else navigator.clipboard?.writeText(url).then(() => toast("Link copied. Send it along."), () => toast("Could not copy the link")); break; }
      case "copyPicks": navigator.clipboard?.writeText(picksText(picksRows(), link())).then(() => toast("Copied as text"), () => toast("Could not copy")); break;
      case "saveShared": app.picks = cleanIds([...app.picks, ...app.shared]); app.shared = []; savePicks(app.picks); pills(); app.ctl?.setPlaces(filtered(), hearted()); rerenderOpen(); toast("Saved to your picks"); break;
      case "xq": { const q = $<HTMLInputElement>("#q"); q.value = ""; q.dispatchEvent(new Event("input")); q.focus(); break; }
    }
  });
  function closeSort(): void { $("#sortmenu").classList.remove("on"); $("[data-act=sort]").setAttribute("aria-expanded", "false"); }
  document.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement; const act = t.dataset?.act;
    if (act === "list") { app.filters.offLists = t.checked ? app.filters.offLists.filter((x) => x !== t.dataset.list) : [...app.filters.offLists, t.dataset.list!]; app.refresh(); }
    else if (act === "anyyear") { app.filters.anyYear = t.checked; app.refresh(); }
    else if (act === "been") { app.filters.hideBeen = t.checked; app.refresh(); }
    else if (act === "theme") setTheme(t.checked ? "light" : "dark");
  });
  $("#scrim").addEventListener("click", () => closeSheetNow());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (openId) { closeSheetNow(); return; }
      if ($("#sortmenu").classList.contains("on")) { closeSort(); return; }
      if ($("#shows").classList.contains("on")) { app.showTab("places"); return; }
      if (selected) closePeek();
    }
    if (e.key === "Tab" && openId) { // keep focus inside the open sheet
      const els = $$<HTMLElement>("button, a[href], input, [tabindex='0']", $(`#${openId}`)).filter((x) => x.offsetParent !== null);
      if (!els.length) return;
      const first = els[0]!, last = els.at(-1)!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === $(`#${openId}`))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  $("#grab").addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") { e.preventDefault(); const c = sheetCtl?.current(); sheetCtl?.snap(c === "peek" ? "half" : c === "half" ? "full" : "peek"); } });
  document.addEventListener("tb:theme", (e) => {
    const t = (e as CustomEvent<"light" | "dark">).detail;
    const b = $("#themeBtn"); b.setAttribute("aria-label", t === "light" ? "Switch to dark theme" : "Switch to light theme"); b.innerHTML = icon(t === "light" ? "u-moon" : "u-sun");
    app.ctl?.setTheme(t);
  });
  { const t = theme(); const b = $("#themeBtn"); b.setAttribute("aria-label", t === "light" ? "Switch to dark theme" : "Switch to light theme"); b.innerHTML = icon(t === "light" ? "u-moon" : "u-sun"); }

  // ---------- first paint: feed from the static shell, then the map
  syncDevice(); topH(); layoutSheet();
  addEventListener("resize", topH);
  recompute(); renderFeed(); pills();
  if (app.shared.length) { toast(`${app.shared.length} picks shared with you. Open Picks to see them.`); }

  const mapEl = $("#map");
  const boot = async () => {
    try {
      const { createMap } = await import("./map");
      const ctl = await createMap(mapEl, cfg, app.view, theme(), {
        onMove: (v, b) => { app.view = v; app.bounds = b; saveView(v); recompute(); renderFeed(); window.dispatchEvent(new CustomEvent("tb:move")); },
        onPlace: (id) => { const p = app.byId.get(id); if (p) { selected = { kind: "place", id }; peekOpen = false; setNearby(p); showPeek(); sheetCtl?.snap("peek"); } },
        onMichelin: (m) => void showMichelin(m),
        onBackground: () => { if (selected) closePeek(); closeSort(); if (!isDesktop() && sheetCtl?.current() === "half") sheetCtl.snap("peek"); },
        onHomeFailing: () => app.setBackend(false),
        onReady: () => { app.ctl!.setPad(sheetPad()); pushMap(); const b = app.ctl!.bounds(); app.bounds = b; recompute(); renderFeed(); window.dispatchEvent(new CustomEvent("tb:mapready")); },
      });
      app.ctl = ctl;
      window.dispatchEvent(new CustomEvent("tb:map"));
    } catch (err) {
      console.warn("map unavailable", err);
      $("#mapnote").hidden = false;
      sheetCtl?.snap("full", false);
    }
  };
  (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback ? (window as unknown as { requestIdleCallback: (f: () => void) => void }).requestIdleCallback(() => void boot()) : setTimeout(() => void boot(), 0);

  const { initSearch } = await import("./search-ui");
  initSearch(app);
  const [{ initWeather }, { initShows }, { initLive }] = await Promise.all([import("./weather-ui"), import("./shows-ui"), import("./live")]);
  initWeather(app); initShows(app); initLive(app);
  if (location.search.includes("debug")) (window as unknown as { __tbApp: App }).__tbApp = app;
  document.fonts?.ready.then(topH).catch(() => {});
  window.dispatchEvent(new CustomEvent("tb:ready"));
}
void metroOf;
