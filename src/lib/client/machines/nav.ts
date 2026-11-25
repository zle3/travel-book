/**
 * Header navigation state machine. Pure: no DOM, no timers. The controller (../site.ts) dispatches events,
 * writes aria-expanded / data-open from the state, and never reads them back.
 * - `menu`: the phone menu is open.  - `dd`: id of the open desktop dropdown, or null.
 */
export type NavState = { menu: boolean; dd: string | null };
export type NavEvent =
  | { type: "TOGGLE_MENU" }
  | { type: "TOGGLE_DD"; id: string }
  | { type: "CLOSE_DD" }
  | { type: "ESCAPE" }
  | { type: "OUTSIDE" }
  | { type: "NAVIGATE" }
  | { type: "RESIZE_DESKTOP" };

export const initialNav = (): NavState => ({ menu: false, dd: null });

/** Returns the same object for events that change nothing (the controller treats identity as a no-op). */
export function step(s: NavState, e: NavEvent): NavState {
  switch (e.type) {
    case "TOGGLE_MENU": return { menu: !s.menu, dd: null };
    case "TOGGLE_DD": return { menu: s.menu, dd: s.dd === e.id ? null : e.id };
    case "CLOSE_DD": return s.dd === null ? s : { ...s, dd: null };
    // Escape closes the innermost layer first: a dropdown, then the phone menu.
    case "ESCAPE": return s.dd !== null ? { ...s, dd: null } : s.menu ? { ...s, menu: false } : s;
    case "OUTSIDE": return s.dd === null ? s : { ...s, dd: null };
    case "NAVIGATE": return s.menu || s.dd !== null ? initialNav() : s;
    case "RESIZE_DESKTOP": return s.menu ? { ...s, menu: false } : s;
  }
}
