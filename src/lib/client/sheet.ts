/** Bottom sheet (phone): min / peek / half / full snaps, 1:1 drag, rubber band at the ends, velocity-projected snap.
 * A flick down goes to min and a flick up goes to full. Under reduced motion the snap is instant (CSS zeroes --t-sheet).
 * Desktop uses the sheet as a static panel and never calls this.
 *
 * Gestures (phone):
 * - A handle (grabber, header bar, chip row line) starts a drag only after TAP_SLOP_PX of vertical movement. Before that the
 *   pointer is a tap: nothing is captured and the click goes through. Horizontal movement hands the gesture to the browser.
 * - Interactive controls (buttons, links, inputs, chips) are never captured before the threshold.
 * - The list body drags the sheet only while it is scrolled to the top and the pull is downward (Apple Maps style).
 *   Otherwise the list scrolls normally.
 * The pure parts (positions, classification, snap choice, rubber band) have no DOM and are unit tested. */

export type Snap = "min" | "peek" | "half" | "full";
export type Positions = Record<Snap, number>;
export type DragClass = "pending" | "drag" | "scroll";

/** Snaps from the top of the screen to the bottom. */
export const SNAP_TOP_TO_BOTTOM: readonly Snap[] = ["full", "half", "peek", "min"];
export const PEEK_PX = 150;
/** Visible height at min: the grabber and a slim bar (the bottom bar sits below the sheet). */
export const MIN_VISIBLE_PX = 56;
export const TAP_SLOP_PX = 8;
/** Pointer speed (px per ms) above which a release counts as a flick. */
export const FLICK_PX_PER_MS = 0.4;
/** How far ahead of the release the sheet is projected when deciding the snap (ms). */
export const PROJECT_MS = 220;

/** Translate-Y of each snap for a sheet of height sheetH. safeBottom is extra room below the min bar (iOS home indicator). */
export function snapPositions(sheetH: number, innerH: number, safeBottom = 0): Positions {
  return {
    full: 0,
    half: Math.max(0, sheetH - Math.round(innerH * 0.46)),
    peek: Math.max(0, sheetH - PEEK_PX),
    min: Math.max(0, sheetH - (MIN_VISIBLE_PX + Math.max(0, safeBottom))),
  };
}

/** Resistance outside [lo, hi]: a third of the overshoot, never a hard stop. */
export function rubberBand(v: number, lo: number, hi: number): number {
  if (v < lo) return lo + (v - lo) / 3;
  if (v > hi) return hi + (v - hi) / 3;
  return v;
}

/** Decides what a pointer that moved (dx, dy) from its start is doing. */
export function classifyDrag(dx: number, dy: number, slop = TAP_SLOP_PX): DragClass {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < slop && ay < slop) return "pending";
  return ax > ay ? "scroll" : "drag";
}

/** The snap nearest to a position. Ties go to the snap listed first in SNAP_TOP_TO_BOTTOM. */
export function nearestSnap(pos: Positions, target: number): Snap {
  let best = SNAP_TOP_TO_BOTTOM[0]!;
  for (const s of SNAP_TOP_TO_BOTTOM) if (Math.abs(pos[s] - target) < Math.abs(pos[best] - target)) best = s;
  return best;
}

/** Snap to go to when a drag is released at y with velocity vel (px per ms, positive is down). */
export function pickSnap(pos: Positions, y: number, vel: number): Snap {
  if (Math.abs(vel) >= FLICK_PX_PER_MS) return vel > 0 ? "min" : "full";
  return nearestSnap(pos, y + vel * PROJECT_MS);
}

/** A tap on the bar or grabber while at min raises the sheet to half. */
export function tapRaises(cur: Snap, kind: "handle" | "list"): boolean {
  return cur === "min" && kind === "handle";
}

export interface SheetCtl { snap(s: Snap, animate?: boolean): void; current(): Snap; visible(): number; destroy(): void }
export interface SheetOpts { handles: HTMLElement[]; list?: HTMLElement | null }

interface Cand {
  id: number; kind: "handle" | "list"; target: HTMLElement;
  x0: number; y0: number;
  dragging: boolean; startY: number; anchorY: number; lastY: number; lastT: number; vel: number;
}

/** Room below the min bar for the iOS home indicator, measured once from a probe element. */
function safeBottomPx(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none";
  document.body.append(probe);
  const h = probe.offsetHeight;
  probe.remove();
  return h;
}

export function initSheet(sheet: HTMLElement, opts: SheetOpts, onSnap: (s: Snap, visiblePx: number) => void): SheetCtl {
  const list = opts.list ?? null;
  let cur: Snap = "half";
  let y = 0;
  let cand: Cand | null = null;
  const safe = safeBottomPx();
  const H = () => sheet.offsetHeight;
  const pos = (): Positions => snapPositions(H(), innerHeight, safe);
  const apply = (v: number, animate: boolean) => {
    y = v;
    sheet.style.transition = animate ? "" : "none";
    sheet.style.transform = `translateY(${v}px)`;
  };
  const snap = (s: Snap, animate = true) => {
    cur = s;
    const p = pos();
    apply(p[s], animate);
    sheet.classList.toggle("full", s === "full");
    sheet.classList.toggle("min", s === "min");
    sheet.dataset.snap = s;
    document.documentElement.classList.toggle("fullmode", s === "full");
    sheet.style.setProperty("--hid", `${p[s]}px`);
    onSnap(s, H() - p[s]);
  };

  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    const kind: "handle" | "list" = target === list ? "list" : "handle";
    if (kind === "list" && list && list.scrollTop > 0) return;   // scrolled: the list scrolls, the sheet stays put
    cand = { id: e.pointerId, kind, target, x0: e.clientX, y0: e.clientY,
      dragging: false, startY: y, anchorY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, vel: 0 };
  };
  const move = (e: PointerEvent) => {
    const c = cand;
    if (!c || e.pointerId !== c.id) return;
    const dx = e.clientX - c.x0, dy = e.clientY - c.y0;
    if (!c.dragging) {
      const g = classifyDrag(dx, dy);
      if (g === "pending") return;
      if (g === "scroll" || (c.kind === "list" && dy <= 0)) { cand = null; return; }
      c.dragging = true;
      c.startY = y; c.anchorY = e.clientY; c.lastY = e.clientY; c.lastT = e.timeStamp; c.vel = 0;
      try { c.target.setPointerCapture(e.pointerId); } catch { /* capture is best effort */ }
      apply(y, false);
      return;
    }
    const p = pos();
    apply(rubberBand(c.startY + (e.clientY - c.anchorY), p.full, p.min), false);
    const dt = Math.max(1, e.timeStamp - c.lastT);
    c.vel = (e.clientY - c.lastY) / dt;
    c.lastY = e.clientY; c.lastT = e.timeStamp;
  };
  const end = (e: PointerEvent) => {
    const c = cand;
    if (!c || e.pointerId !== c.id) return;
    cand = null;
    if (!c.dragging) {
      if (e.type === "pointerup" && tapRaises(cur, c.kind)) snap("half");
      return;
    }
    snap(pickSnap(pos(), y, c.vel));
  };
  // While a list pull is a sheet drag, stop the browser from scrolling the list (that would cancel the pointer stream).
  const blockPull = (e: TouchEvent) => {
    const c = cand;
    if (!c || c.kind !== "list" || !e.cancelable) return;
    const t = e.touches[0];
    if (!t) return;
    if (c.dragging || t.clientY - c.y0 > TAP_SLOP_PX) e.preventDefault();
  };

  const events: [string, (e: PointerEvent) => void][] = [
    ["pointerdown", down], ["pointermove", move], ["pointerup", end], ["pointercancel", end],
  ];
  const all = list ? [...opts.handles, list] : opts.handles;
  for (const h of all) for (const [t, fn] of events) h.addEventListener(t, fn as EventListener);
  sheet.addEventListener("touchmove", blockPull, { passive: false });

  const onResize = () => snap(cur, false);
  addEventListener("resize", onResize);
  return {
    snap,
    current: () => cur,
    visible: () => H() - pos()[cur],
    destroy: () => {
      removeEventListener("resize", onResize);
      sheet.removeEventListener("touchmove", blockPull);
      for (const h of all) for (const [t, fn] of events) h.removeEventListener(t, fn as EventListener);
    },
  };
}
