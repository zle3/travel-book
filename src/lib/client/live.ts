/** Live data from the owner's home backend (Discord adds) and the offline check. The backend does not exist yet at v1: every call fails softly. */
import type { App } from "./app";
import type { Place } from "./store";

interface LivePlace { id: string; name: string; lat: number; lng: number; category?: string; note?: string; added?: string }
export interface LiveEvent { id: string; title: string; venue?: string; city?: string; start: string; end?: string; url?: string; added?: string }

const cleanText = (s: unknown, n: number): string => String(s ?? "").slice(0, n);

/** Backend payload to Place and event records; invalid rows are dropped. Pure, exported for tests. */
export function adaptLive(j: unknown, validCats: Set<string>): { places: Place[]; events: LiveEvent[] } {
  const o = (j ?? {}) as { places?: LivePlace[]; events?: LiveEvent[] };
  const places = (Array.isArray(o.places) ? o.places : []).flatMap((p): Place[] => {
    if (!p || typeof p.id !== "string" || !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return [];
    return [{ id: `d${p.id}`.replace(/[^0-9a-z]/gi, "").toLowerCase().slice(0, 16), n: cleanText(p.name, 120), c: validCats.has(String(p.category)) ? String(p.category) : "other", s: "m", l: ["discord"], note: cleanText(p.note, 300), addr: "", maps: "", x: p.lng, y: p.lat, added: p.added, live: true }];
  });
  const events = (Array.isArray(o.events) ? o.events : [])
    .filter((e) => e && typeof e.id === "string" && typeof e.title === "string" && /^\d{4}-\d{2}-\d{2}/.test(String(e.start)))
    .map((e) => ({ ...e, title: cleanText(e.title, 160), venue: cleanText(e.venue, 120), city: cleanText(e.city, 80), url: /^https?:\/\//.test(String(e.url)) ? String(e.url) : "" }));
  return { places, events };
}

export function initLive(app: App): void {
  const cats = new Set(app.cfg.categories.categories.map((c) => c.id));
  let events: LiveEvent[] = [];
  (window as unknown as { __tbLiveEvents: () => LiveEvent[] }).__tbLiveEvents = () => events;
  async function pull(): Promise<void> {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch("/api/live", { signal: ctl.signal }).finally(() => clearTimeout(t));
      if (!r.ok) throw new Error(String(r.status));
      const live = adaptLive(await r.json(), cats);
      events = live.events;
      app.addLive(live.places);
      app.setBackend(true);
      window.dispatchEvent(new CustomEvent("tb:live"));
    } catch { app.setBackend(false); }
  }
  async function health(): Promise<void> {
    if (document.visibilityState !== "visible") return;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2000);
      const r = await fetch("/api/health", { signal: ctl.signal, cache: "no-store" }).finally(() => clearTimeout(t));
      if (!r.ok) throw new Error(String(r.status));
      if (app.backendUp === false) void pull(); else app.setBackend(true);
    } catch { app.setBackend(false); }
  }
  void pull();
  setInterval(() => void health(), 60000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void health(); });
}
