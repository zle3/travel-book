# Round 1 shared brief: Little Travel Book (task design-r1)

You are building ONE direction of round 1 (diverge). The director owns the round. Read this file, then the direction brief in your prompt.

## Where things are
- Task worktree: `/mnt/wsl/work/worktrees/travel-book-design-r1` (branch `task/design-r1`). Write ONLY inside `docs/design/round-1/<your-slug>/`. Touch nothing else: no `src/`, no styles, no PRODUCT.md, no commits (the director commits).
- Product truth: `/home/sakiaya/projects/travel-book/PRODUCT.md` (main checkout; the worktree copy is still a placeholder). Design rules: `/mnt/wsl/work/worktrees/travel-book-design-r1/DESIGN.md`.
- Real data, already scrubbed for you: `/mnt/wsl/work/worktrees/travel-book-design-r1/docs/design/round-1/_data/sample.json`
  - `lists` (all 28 lists with group, source mine/friends, count), `totals` (2,081 places; 575 his; 1,506 from friends' lists)
  - `sf_window_mine` / `sf_window_friends`: real SF places with lat/lng, for the map
  - `places_with_notes`: places carrying his short notes (e.g. "8.5 Egg Tart", "Opens late", "Michelin Bib", "Mocktails!")
  - `curated`: entries from his curated Bay Area / Sacramento / Seattle databases (name, area, note, been)
  - `shows_snapshot`: real 19hz.info Bay Area listings fetched 2026-11-24
  - Copy what you need INLINE into your HTML (file:// pages cannot fetch). Never use data from anywhere else.
- Screenshot helper: `node /tmp/claude-1000/-home-sakiaya-travel/dfd1d219-8da1-4b94-af85-e665af879cfb/scratchpad/design-r1/shot.mjs <html> <out.png> <w> <h> <light|dark> [full]`. It sets the OS colour scheme, waits for network idle plus 2.5s.

## The product in one breath
Zach sends this link to his date by text. On her phone she browses places he has saved (map and list, filtered), taps hearts on what sounds fun, and sends her picks back (a share link that encodes them, or copied text). There is also "shows coming up": live DJ / concert listings from 19hz.info. It must feel hand-made, artistic, cutesy, warm, playful, a little romantic. A gift, never a directory, never SaaS.

## Truth rules (hard)
- Only real places, lists and notes from sample.json. Never invent places, ratings, prices, reviews or claims. His notes are his own words; show them as his.
- Friends' lists (SF, Sac, Bay Area, NYC) are always labeled as friends' recommendations and toggle separately from his own lists.
- Never imply he has been somewhere unless `been: true`.
- Never show private details: no trip dates, tickets, hotel bookings, calendar, profile, allergies or food flags. "Hotels" and "Parking Lots" are just saved lists.
- Shows: use the snapshot rows as they are, credit "Listings from 19hz.info", and mark them "snapshot, 24 Nov" in the prototype. Never invent shows.
- Authored copy (greetings, button labels, empty states) is yours to write in a warm first-person voice from Zach. Keep it short. Do not use the word "date" on the page.

## Palette (his zachle.info scheme `zli-ppr-custom`; RGB triplets)
- primary mauve: 200 248,244,246 · 300 217,198,208 · 400 186,153,170 · 500 155,107,132 · 600 132,89,111 · 700 108,73,91 · 800 83,56,70 · 900 59,40,50
- secondary rose: 50 255,241,242 · 100 255,228,230 · 200 254,205,211 · 300 253,164,175 · 400 251,113,133 · 500 244,63,94 · 600 225,29,72 · 700 190,18,60 · 800 159,18,57 · 900 136,19,55
- neutral lavender-grey: 200 249,249,251 · 300 205,205,219 · 400 160,160,187 · 500 116,116,155 · 600 96,96,134 · 700 79,79,110 · 800 62,62,86 · 900 45,45,63
- You may derive tints/shades in the same hue families for material (thread, ink overprint, paper stock). Do NOT drift to cream, beige, terracotta or neon-on-black: those are spent defaults.
- Light AND dark are both required (his site defaults to dark). Follow `prefers-color-scheme` and add a working theme toggle. Define all colours as CSS custom properties on `:root` with a dark override. WCAG AA contrast in both themes.

## Craft floor (hard)
- Real size: phone 390x844, desktop 1440x900. No horizontal scroll at 390. Tap targets at least 44x44. Functional text at least 12px.
- No kicker/eyebrow labels above headings. No all-caps tracked labels; sentence case. No coloured border-left/border-top of 2px or more as decoration. No gradient text, no decorative glass/blur, no zero-blur hard offset shadows, no emoji or unicode glyphs as icons (draw SVG icons in one consistent stroke). No headline + button over a row of equal cards. No split hero with a badge row.
- Fonts: Google Fonts allowed in prototypes (production will self-host). Do not use Fraunces, Playfair Display, Cormorant, Lora, Crimson, Newsreader, Syne, Space Grotesk/Mono, IBM Plex, Inter, DM Sans/Serif, Outfit, Plus Jakarta Sans, Instrument Sans.
- Theme browser surfaces: text selection, focus rings (visible `:focus-visible`), scrollbars, caret.
- Hearts are real buttons (`aria-pressed`, a label naming the place). Respect `prefers-reduced-motion`.
- The world is the carrier of the page, never a picture of it: navigation reads as links, the heart reads as tappable, text sits on a readable ground. The first viewport is a working screen, not a cover.

## Map
- MapLibre GL JS from `https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js` (+ `.css`), style `https://tiles.openfreemap.org/styles/positron` (open data, no key). After `load`, restyle every layer's paint (background, water, landuse, roads, labels) into your world's palette; hide clutter layers. Credit "© OpenStreetMap contributors · OpenFreeMap" visibly.
- Places as a GeoJSON source with `cluster: true`. Markers and clusters must be drawn in your world's grammar (HTML markers or symbol layers with authored SVG images). This is a key thing the owner wants to see.
- If tiles fail to load, the page must still show your styled ground and markers (do not leave a grey box).

## Deliverables in `docs/design/round-1/<slug>/`
1. `index.html`: the phone landing, 390x844, the first screen she sees after tapping the link. Working parts: a short greeting, real places with working hearts (count updates live), the picks count and the send action reachable, and a way into map / list / shows. This file is drawn on the owner's decision page as a skeleton where text under 22px becomes bars, so the composition, palette and display type must carry the direction on their own.
2. `screens.html`: a board of four more phone frames at 1:1 (each 390x844, side by side, labeled under the frame): (a) map with synced list peek and filters (by list incl. Hotels and Parking Lots, by group, region, "from friends" toggle, hide "been"); (b) one place opened with its heart (use a place with a note); (c) the picks sheet with 4 to 6 hearted picks, "Send to Zach" (share link) and "Copy as text"; (d) shows coming up (snapshot rows, credited). At least two frames in the dark theme.
3. `desktop.html`: 1440x900 desktop, map plus synced list plus filters, same world.
4. Screenshots: `index-light.png` and `index-dark.png` (390x844), `screens.png` (full page), `desktop.png` (1440x900). LOOK at every one and fix what is broken before reporting.
5. `notes.md` (short): fonts, the signature interaction written as motion grammar (trigger, what moves, duration/easing, reduced-motion fallback), what is synthetic, honest risks.

Report back in under 12 lines: files, one line each, plus the top risk.
