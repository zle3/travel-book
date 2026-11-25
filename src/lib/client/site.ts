/** Shared client behaviour: header menu + dropdowns (state machine in ./machines/nav.ts) and the theme toggle. */
import { initialNav, step, type NavEvent, type NavState } from "./machines/nav";

export function initSite(): void {
  initNav();
  initTheme();
}

function initNav(): void {
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  if (!header) return;
  const toggle = header.querySelector<HTMLButtonElement>("[data-menu-toggle]");
  const dds = [...header.querySelectorAll<HTMLElement>("[data-dd]")];
  let state: NavState = initialNav();

  const render = (): void => {
    header.dataset.menuOpen = String(state.menu);
    toggle?.setAttribute("aria-expanded", String(state.menu));
    toggle?.setAttribute("aria-label", state.menu ? "Close menu" : "Open menu");
    for (const dd of dds) {
      const open = state.dd === dd.dataset.dd;
      dd.dataset.open = String(open);
      dd.querySelector("[data-dd-button]")?.setAttribute("aria-expanded", String(open));
    }
  };
  const dispatch = (e: NavEvent): void => {
    const next = step(state, e);
    if (next === state) return;
    state = next;
    render();
  };

  toggle?.addEventListener("click", () => dispatch({ type: "TOGGLE_MENU" }));
  for (const dd of dds) {
    const id = dd.dataset.dd ?? "";
    dd.querySelector("[data-dd-button]")?.addEventListener("click", () => dispatch({ type: "TOGGLE_DD", id }));
    dd.addEventListener("focusout", (ev) => { if (!dd.contains((ev as FocusEvent).relatedTarget as Node | null) && state.dd === id) dispatch({ type: "CLOSE_DD" }); });
  }
  header.addEventListener("click", (ev) => { if ((ev.target as Element).closest("a[href]")) dispatch({ type: "NAVIGATE" }); });
  document.addEventListener("click", (ev) => { if (!header.contains(ev.target as Node)) dispatch({ type: "OUTSIDE" }); });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    const before = state;
    dispatch({ type: "ESCAPE" });
    // Return focus to whatever opened the layer that just closed.
    if (before.dd !== null && state.dd === null) header.querySelector<HTMLElement>(`[data-dd="${before.dd}"] [data-dd-button]`)?.focus();
    else if (before.menu && !state.menu) toggle?.focus();
  });
  const mq = window.matchMedia("(min-width: 48.01rem)");
  mq.addEventListener("change", () => { if (mq.matches) dispatch({ type: "RESIZE_DESKTOP" }); });
  render();
}

function initTheme(): void {
  const key = document.documentElement.dataset.themeKey ?? "theme";
  const btn = document.querySelector<HTMLButtonElement>("[data-theme-toggle]");
  const current = (): "light" | "dark" => {
    const t = document.documentElement.dataset.theme;
    return t === "light" || t === "dark" ? t : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  };
  const sync = (): void => btn?.setAttribute("aria-label", current() === "dark" ? "Switch to light theme" : "Switch to dark theme");
  btn?.addEventListener("click", () => {
    const next = current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(key, next); } catch {}
    document.dispatchEvent(new CustomEvent("theme-change", { detail: next }));
    sync();
  });
  sync();
}
