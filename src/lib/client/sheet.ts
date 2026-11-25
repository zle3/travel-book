/** Bottom sheet (phone): peek / half / full snaps, 1:1 drag, rubber band at the ends, velocity-projected snap, no overshoot.
 * Under reduced motion the snap is instant (CSS zeroes --t-sheet). Desktop uses the sheet as a static panel and never calls this. */
export type Snap = "peek" | "half" | "full";
export interface SheetCtl { snap(s: Snap, animate?: boolean): void; current(): Snap; visible(): number; destroy(): void }

export function initSheet(sheet: HTMLElement, handles: HTMLElement[], onSnap: (s: Snap, visiblePx: number) => void): SheetCtl {
  let cur: Snap = "half";
  let y = 0, startY = 0, startPt = 0, dragging = false, lastT = 0, lastP = 0, vel = 0;
  const H = () => sheet.offsetHeight;
  const pos = (): Record<Snap, number> => ({ full: 0, half: Math.max(0, H() - Math.round(innerHeight * 0.46)), peek: Math.max(0, H() - 150) });
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
    sheet.dataset.snap = s;
    document.documentElement.classList.toggle("fullmode", s === "full");
    sheet.style.setProperty("--hid", `${p[s]}px`);
    onSnap(s, H() - p[s]);
  };
  const down = (e: PointerEvent) => {
    if ((e.target as Element).closest("button.seg, .seg button, .sortb, .sortmenu")) return;
    dragging = true; startPt = e.clientY; startY = new DOMMatrix(getComputedStyle(sheet).transform).m42; lastP = e.clientY; lastT = e.timeStamp; vel = 0;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    apply(startY, false);
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const p = pos();
    let v = startY + (e.clientY - startPt);
    if (v < 0) v = v / 3;                                  // rubber band at the top
    if (v > p.peek) v = p.peek + (v - p.peek) / 3;         // and at the bottom
    const dt = Math.max(1, e.timeStamp - lastT);
    vel = (e.clientY - lastP) / dt; lastP = e.clientY; lastT = e.timeStamp;
    apply(v, false);
  };
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const p = pos();
    const target = y + vel * 220;
    const best = (Object.keys(p) as Snap[]).reduce((a, b) => (Math.abs(p[b] - target) < Math.abs(p[a] - target) ? b : a));
    snap(best);
  };
  for (const h of handles) {
    h.addEventListener("pointerdown", down);
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", end);
    h.addEventListener("pointercancel", end);
    h.addEventListener("lostpointercapture", end);
  }
  const onResize = () => snap(cur, false);
  addEventListener("resize", onResize);
  return { snap, current: () => cur, visible: () => H() - pos()[cur], destroy: () => removeEventListener("resize", onResize) };
}
