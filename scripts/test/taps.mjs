// Phone tap-target rule, shared by smoke.mjs (every built route) and tests/smoke-taps.test.mjs (fixtures).
// smallTapTargets runs in the browser via page.evaluate(smallTapTargets): keep it self-contained (no closures).
// Returns "selector WxH" strings for visible interactive elements whose hit box is under 44x44 CSS px.
// Checkbox and radio: passes when its own box is at least 44x44. Otherwise the label is the tap target. The input passes when its label (wrapping <label>, or
// label[for=id]) is at least 44x44 and the input sits inside or next to that label's box (4px). A visually
// hidden input whose label is the visible control is judged the same way. No label: the input is judged itself.
export function smallTapTargets() {
  const sel = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : "");
  const out = [];
  for (const el of document.querySelectorAll("a[href], button, [role=button], input:not([type=hidden]), select, summary")) {
    if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.bottom <= 0 || r.right <= 0) continue; // parked off-screen (e.g. the skip link until focused)
    if (el.matches("a") && getComputedStyle(el).display === "inline") {
      const para = el.closest("p, li, dd, blockquote");
      if (para && (para.textContent || "").replace(el.textContent || "", "").trim().length > 0) continue;
    }
    if (el.matches("input[type=checkbox], input[type=radio]")) {
      const label = el.closest("label") || (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
      if (r.width >= 43.5 && r.height >= 43.5) continue; // the input's own hit box is big enough
      if (label) {
        const l = label.getBoundingClientRect();
        const near = r.left >= l.left - 4 && r.right <= l.right + 4 && r.top >= l.top - 4 && r.bottom <= l.bottom + 4;
        if (near && l.width >= 43.5 && l.height >= 43.5) continue;
        out.push(`${sel(el)} ${Math.round(r.width)}x${Math.round(r.height)} (label ${Math.round(l.width)}x${Math.round(l.height)})`);
        continue;
      }
    }
    if (r.width < 43.5 || r.height < 43.5) out.push(`${sel(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
}
