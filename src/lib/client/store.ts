/** Shared client state, storage and tiny helpers. Storage is always wrapped: private mode and blocked storage must never break the app. */
import { defaultFilters, parseFilters } from "../filters.ts";
import type { Filters } from "../filters.ts";
import { cleanIds } from "../picks.ts";
import { codeFromText } from "../data/michelin.ts";
export { codeFromText };

export interface Place {
  id: string; n: string; c: string; s: "m" | "o"; l: string[]; note: string; addr: string; maps: string; x: number; y: number; mich?: string;
  /** live (Discord) items only */
  added?: string; live?: boolean; been?: boolean;
  /** another branch of a saved chain: ex = 1, br = branch label */
  ex?: 1; br?: string;
}
export interface Cat { id: string; label: string; group: string; icon: string }
export interface Group { id: string; label: string; chip: string; icon: string; hex: string }
export interface Manifest { places: string; areas: string; counts: { places: number; michelin: number }; lists: { id: string; name: string; source: "m" | "o"; count: number }[]; michelinYears: number[]; currentEdition: number; hasBeen: boolean }
export interface Config { manifest: Manifest; categories: { groups: Group[]; categories: Cat[]; uncategorized: Cat & { hex: string }; awards: { id: string; label: string; hex: string }[] } }
export type Sort = "near" | "mix" | "az";
export interface View { lng: number; lat: number; zoom: number }

export const SF_VIEW: View = { lng: -122.4194, lat: 37.7749, zoom: 12.4 };
const K = { filters: "tb-filters", picks: "tb-picks", view: "tb-view", sort: "tb-sort", dense: "tb-dense", seen: "tb-seen" } as const;

const rd = (k: string): unknown => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch { return null; } };
const wr = (k: string, v: unknown): void => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export const loadFilters = (): Filters => parseFilters(rd(K.filters));
export const saveFilters = (f: Filters): void => wr(K.filters, f);
export const loadPicks = (): string[] => { const v = rd(K.picks); return Array.isArray(v) ? cleanIds(v) : []; };
export const savePicks = (ids: string[]): void => wr(K.picks, ids);
export function loadView(): View | null {
  const v = rd(K.view) as Partial<View> | null;
  return v && [v.lng, v.lat, v.zoom].every((n) => typeof n === "number" && Number.isFinite(n)) && Math.abs(v.lat!) <= 85 && Math.abs(v.lng!) <= 180 && v.zoom! >= 0 && v.zoom! <= 22 ? (v as View) : null;
}
export const saveView = (v: View): void => wr(K.view, { lng: +v.lng.toFixed(5), lat: +v.lat.toFixed(5), zoom: +v.zoom.toFixed(2) });
export const loadSort = (): Sort => { const v = rd(K.sort); return v === "mix" || v === "az" ? v : "near"; };
export const saveSort = (s: Sort): void => wr(K.sort, s);
export const denseDismissed = (): boolean => rd(K.dense) === true;
export const dismissDense = (): void => wr(K.dense, true);

export const theme = (): "light" | "dark" => (document.documentElement.dataset.theme === "light" ? "light" : "dark");
export function setTheme(t: "light" | "dark"): void {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(document.documentElement.dataset.themeKey ?? "tb-theme", t); } catch { /* ignore */ }
  document.dispatchEvent(new CustomEvent("tb:theme", { detail: t }));
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T[] => [...root.querySelectorAll(sel)] as T[];
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const icon = (name: string, cls = ""): string => `<svg class="ic ${cls}" aria-hidden="true" focusable="false"><use href="#${name}"></use></svg>`;
export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const isDesktop = (): boolean => document.documentElement.classList.contains("desktop");

let toastTimer = 0;
export function toast(msg: string): void {
  const t = $("#toast"); t.textContent = msg; t.classList.add("on");
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => t.classList.remove("on"), 2600);
}
export const NEW_DAYS = 7;
/** "New" badge for owner-added (live) items for 7 days; no pinning. */
export const isNew = (added: string | undefined, now = Date.now()): boolean => { const t = added ? Date.parse(added) : NaN; return Number.isFinite(t) && now - t < NEW_DAYS * 86400000 && now >= t - 86400000; };
export { defaultFilters };
