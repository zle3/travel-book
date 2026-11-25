/** Shows tab: 19hz.info listings through the Worker (cached an hour), by region and date range, searchable. Owner-added events sit alongside. */
import { dayLabel, filterShows, groupByDate, regionFor } from "../shows";
import type { Range, ShowLike } from "../shows";
import type { App } from "./app";
import type { LiveEvent } from "./live";
import { $, esc, icon, isNew } from "./store";

interface Show extends ShowLike { url: string; price: string; age: string; live?: boolean; added?: string }
const REGIONS: [string, string][] = [["bayarea", "Bay Area"], ["seattle", "Seattle"], ["losangeles", "Los Angeles"]];
const RANGES: [Range, string][] = [["today", "Today"], ["weekend", "This weekend"], ["week", "Next 7 days"], ["all", "All upcoming"]];

export function initShows(app: App): void {
  const host = $("#shows");
  let region = "bayarea", range: Range = "week", q = "";
  let events: Show[] = [];
  let state: "idle" | "loading" | "ok" | "error" = "idle";
  const cache = new Map<string, Show[]>();
  let regionSet = false;

  const liveShows = (): Show[] => {
    const get = (window as unknown as { __tbLiveEvents?: () => LiveEvent[] }).__tbLiveEvents;
    return (get?.() ?? []).map((e) => ({ id: `live-${e.id}`, title: e.title, venue: e.venue, city: e.city, date: e.start.slice(0, 10), when: e.start.slice(11, 16), url: e.url ?? "", price: "", age: "", live: true, added: e.added }));
  };

  async function load(): Promise<void> {
    if (cache.has(region)) { events = cache.get(region)!; state = "ok"; render(); return; }
    state = "loading"; render();
    const my = region;
    try {
      const r = await fetch(`/api/events?region=${my}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { events: Show[] };
      cache.set(my, j.events);
      if (my === region) { events = j.events; state = "ok"; }
    } catch { if (my === region) state = "error"; }
    render();
  }

  function render(): void {
    const now = new Date();
    const list = filterShows([...liveShows(), ...(state === "ok" ? events : [])], { q, range, now });
    const groups = groupByDate(list);
    const rows = groups.map((g) => `<h3 class="dayh">${esc(dayLabel(g.date, now))}</h3>${g.items.map((e) => {
      const inner = `<span class="ico g-sights">${icon("u-shows")}</span><span class="rtx"><h4>${esc(e.title)}</h4><p>${esc([e.when, e.venue, e.city && `(${e.city})`].filter(Boolean).join(" · "))}</p>${e.tags?.length ? `<p class="gn">${esc(e.tags.slice(0, 4).join(", "))}</p>` : ""}${e.price || e.age ? `<p class="gn">${esc([e.price, e.age].filter(Boolean).join(" · "))}</p>` : ""}${e.live ? `<span class="gn"><span class="bd bd-pick">Zach's pick</span>${isNew(e.added) ? '<span class="bd bd-new">New</span>' : ""}</span>` : ""}</span>`;
      return e.url ? `<a class="show${e.live ? " own" : ""}" href="${esc(e.url)}" target="_blank" rel="noopener">${inner}<span class="go" aria-hidden="true">${icon("u-ext")}</span></a>` : `<div class="show${e.live ? " own" : ""}">${inner}</div>`;
    }).join("")}`).join("");
    const status = state === "loading" ? `<div class="empty"><b>Loading shows…</b></div>`
      : state === "error" ? `<div class="empty"><b>Shows are taking a nap.</b>The listing could not be reached right now.<button class="btn" data-act="showsRetry" type="button">Try again</button></div>`
      : !list.length ? `<div class="empty"><b>No shows match.</b>Try another day range, region or search.</div>` : "";
    host.innerHTML = `<div class="shead2"><h2>Shows coming up</h2><button class="ibtn" data-act="tab" data-tab="places" aria-label="Close shows" type="button">${icon("u-close")}</button></div>
<div class="showsbar"><div class="seg" role="group" aria-label="Region">${REGIONS.map(([k, l]) => `<button data-act="region2" data-r="${k}" aria-pressed="${region === k}" type="button">${l}</button>`).join("")}</div>
<div class="search flat"><label class="vh" for="sq">Search shows</label>${icon("u-search")}<input id="sq" type="search" placeholder="Search shows, venues, genres" value="${esc(q)}" autocomplete="off" /></div>
<div class="cw rng" role="group" aria-label="Date range">${RANGES.map(([k, l]) => `<button class="chip" data-act="range" data-range="${k}" aria-pressed="${range === k}" type="button">${l}</button>`).join("")}</div></div>
<div class="shows" aria-live="polite">${status}${rows}<p class="credit-l">Listings from <a href="https://19hz.info" target="_blank" rel="noopener">19hz.info</a>, fetched by this site and cached for about an hour.</p></div>`;
  }

  host.addEventListener("click", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-act]");
    if (!t) return;
    if (t.dataset.act === "region2") { region = t.dataset.r!; regionSet = true; void load(); }
    else if (t.dataset.act === "range") { range = t.dataset.range as Range; render(); }
    else if (t.dataset.act === "showsRetry") { cache.delete(region); void load(); }
  });
  host.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id !== "sq") return;
    q = t.value;
    const pos = t.selectionStart;
    render();
    const n = $<HTMLInputElement>("#sq");
    n.focus();
    n.setSelectionRange(pos, pos);
  });
  window.addEventListener("tb:shows", () => {
    if (!regionSet) region = regionFor(app.view.lng, app.view.lat);
    if (state === "idle" || state === "error" || !cache.has(region)) void load(); else render();
  });
  window.addEventListener("tb:live", () => { if (host.classList.contains("on")) render(); });
}
