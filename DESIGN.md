# Little Travel Book — design & build contract

Every page and component follows this file. Rules marked (lint) are enforced by `scripts/test/lint-design.mjs`, configured in `ops/lint-design.json`. This file is a skeleton: fill the project-specific sections (Source of truth, Theme, Tokens, Component catalogue) as the design system is decided. The universal rules below apply from day one.

## Source of truth for content/behaviour
- Mode: **new**. Rebuild projects: the captured original in `_source/` (see `_source/INVENTORY.md`) is the source of content and behaviour; do not drop a route, form or feature without an owner decision. New projects: `PRODUCT.md`.
- Owner-only placeholders live in `src/data/content.ts` (the starter ships one example, rendered tagged "Sample" on the about page); they carry `placeholder: true`, which the deploy guard in `ops/project.conf` blocks on. Fill in where the rest of the copy lives (e.g. more `src/data/*.ts`).

## Rules (universal)
1. **Tokens only.** Colours, spacing, radii, font sizes and shadows come from CSS custom properties defined once (`src/styles/`). No hardcoded hex colours or `#fff`/`#000` backgrounds in component or feature CSS (lint). The only place raw colour values appear is the `:root` token block (and the dark override).
2. **No inline styles.** No `style=""` in `.astro` files except truly dynamic values (width, height, visibility, e.g. a meter width) (lint). No `<style>` blocks with colours or fonts in pages; use classes from the stylesheet.
3. **No thick edge stripes.** No coloured `border-left`/`border-top` of 2px or more as decoration (lint).
4. **No `pt` units in screen CSS.** Use `rem`/`px`/`em`. `pt` belongs only inside `@media print` (lint).
5. **Optional rules (opt in per project in `ops/lint-design.json`):** `noAllCaps` forbids `text-transform: uppercase` tracked labels.
6. **Small text.** Define a type scale (`--fs-xs`, `--fs-sm`, `--fs-md`); functional text never goes below `.75rem`. Headings tighten tracking slightly, small text at most `.01em`.
7. **No external CDNs, no UI frameworks** unless this file says so. Fonts are self-hosted or system fonts.
8. Client scripts: `<script>` in `.astro` (bundled TS) or modules under `src/lib/client/`. No global mutable state shared between features.

## Starter (what ships in `src/`)
- **Layouts:** `layouts/Base.astro` (head metadata, noindex, icons, theme-before-paint, concept notice for rebuilds, client script) and `layouts/Page.astro` (Base + Header + `<main id="main">` + Footer). Every page uses `Page`.
- **Site facts:** `lib/site.ts` (`SITE`, `NAV`, `CTA`, `FOOTER_LINKS`). Navigation entries may carry `children` to get an accessible dropdown.
- **Header (`components/Header.astro`):** brand, primary nav, optional dropdown, one CTA, theme toggle, phone menu button. Behaviour is the pure machine `lib/client/machines/nav.ts` driven by `lib/client/site.ts`. Dropdowns open by click and close on Escape, outside click and focus leaving; they are never opened by `:hover`/`:focus-within` (two sources of truth). **Closed menus are `visibility: hidden` + `pointer-events: none`, never `opacity: 0` alone**, so they cannot eat taps; the smoke test taps a grid and fails on any invisible hit target. Tap targets are at least 44x44 on phones (links, buttons, menu items, CTA); the smoke test measures every visible interactive element at 390px and exempts only links inside running text. The starter ships one example dropdown (About) so the dropdown, its Escape/outside-click behaviour and the race harness are exercised.
- **Footer, `Icon.astro`** (`lib/icons.ts` holds the SVG bodies; add icons there).
- **Assets:** `node scripts/assets/build-icons.mjs [--name ... --domain ...]` regenerates favicon (svg, ico), apple-touch-icon, 192/512 icons and the 1200x630 preview card (`public/assets/preview-card.png`, an exact public path in `worker/index.ts`). Re-run it after the brand is decided; the shipped set is neutral.

## Tokens
Defined once in `src/styles/global.css` `:root` (light), the `prefers-color-scheme: dark` block and `:root[data-theme="dark"]` (keep the two dark blocks identical).
- Colour: `--bg --surface --surface-2 --ink --ink-2 --muted --line --accent --accent-ink --accent-soft --focus --warn-bg --warn-ink --scrim`.
- Type: `--font-sans --font-mono`, scale `--fs-xs --fs-sm --fs-md --fs-lg --fs-xl --fs-2xl`, `--lh-body`.
- Space `--space-1..7`, shape `--radius-sm --radius`, depth `--shadow-sm --shadow`, motion `--ease --t-fast --t-base`, layout `--measure --wrap --header-h`.
New tokens are added to `:root` (and both dark blocks) first, then used.

## Theme (light + dark)
- Starter behaviour: dark follows the OS unless the visitor picks via a header toggle (store the choice under a project-prefixed `localStorage` key, applied before first paint). Dark applies on screen only.
- JS that draws colours (SVG charts, canvas) reads tokens via `getComputedStyle(document.documentElement)` or uses `currentColor`/CSS classes, and re-renders on the theme-change event.

## Print rules
- Print is always light and plain: a single `@media print` block per stylesheet hides navigation and interactive chrome, forces dark text on white, expands link URLs where useful, avoids page breaks inside cards, tables and figures.
- Print is the one place `pt` units and hardcoded colours are allowed.

## Accessibility floor
- WCAG 2.2 AA contrast in both themes; visible `:focus-visible` outline on every interactive element (never `outline: none` without a replacement).
- Touch targets at least 44x44 px on phone widths; no sideways scroll at 360 px wide.
- One `<h1>` per page, ordered headings, landmarks (`header`, `nav`, `main`, `footer`), `lang` on `<html>`, alt text on meaningful images and `alt=""` on decorative ones.
- Every control is keyboard operable; errors are announced (`role="alert"` or `aria-live`) and tied to their field. Respect `prefers-reduced-motion`.
- Colour is never the only carrier of meaning.

## Component catalogue
| Component | Class / file | Notes |
|---|---|---|
| Button | `.btn` + `.btn--primary` / `.btn--secondary` | 44 px min height, press state, `[disabled]` |
| Icon button | `.icon-btn` | 44x44; theme toggle, menu toggle |
| Card | `.card` (in `.grid`) | surface + line + `--shadow-sm` |
| Badge | `.badge`, `.badge--sample` | sentence case; `--sample` tags demo data |
| Notice | `.notice`, `.concept-notice` | the concept notice is rendered by `Base.astro` when `SITE.conceptOf` is set; never remove it |
| Form field | `.field` (label, control, `.hint`), `.error` | errors tied to the field with `aria-describedby`, announced with `role="alert"` |
| Table | `table` inside `.table-wrap` | scrolls inside its wrapper, never the page |
| Header / nav / dropdown | `.site-header`, `.nav-links`, `.nav-dd` | see Starter |
| Footer | `.site-footer` | |
| Layout | `.wrap`, `.section`, `.section--alt`, `.hero`, `.page-hero`, `.stack`, `.prose`, `.lead`, `.meta`, `.actions` | |
Add a row when a component is added; restyle by changing tokens first.

## State machines
Any interactive feature with more than two states (forms, wizards, demos, async flows) is modelled as a state machine, not as scattered booleans.
- **Shape:** pure and typed. `export type XState = {kind:"..."...} | ...`, `export type XEvent = {type:"UPPER_SNAKE"; now?:number; token?:number} | ...`, `export function step(s, e): XState`, `export const initialX = (): XState => ...`. No DOM, no timers, no `Date.now()` inside `step` (time arrives in the event).
- **Controller:** one `dispatch(e)` per feature: `step`, then exit and enter effects, then `render(state)`. Every timer or async call captures a `token` and comes back as an event; the reducer drops stale tokens. Timers are cleared on state exit.
- **Tests:** unit tests drive `step` with event sequences (`scripts/test/unit/*.test.mjs`); races (double submit, late response, rapid toggles) get a browser race in `scripts/test/races/*.race.mjs`.

## Verify
`scripts/check.sh --fast` (types, design lint, unit and gate tests, ops tests, build) before every push. The merge queue runs the full `scripts/check.sh` (adds link check, browser smoke on every route with the invisible-hit-target check, races of at most 30 s each, serially).
