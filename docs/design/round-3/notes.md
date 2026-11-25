# Round 3 notes (A, map first, refined)

Files: `phone.html` (390x844), `desktop.html` (1440x900), `states.html` (live iframes) + `phone-states.png` (20-frame board, composed from per-frame captures), `icons.html/png`, `build/` (tokens.css, icons.svg, categories.json, map-config.js). All HTML is generated from the build/ files, so the prototype and the assets cannot drift. Preset states via hash: `t=light|dark`, `s=filters|peek|picks|shows|legend|search|owner`, `p=<name>`, `q=<text>`, `z`, `c=lng,lat`, `michelin=1`, `mk=stars,bib`, `loc=prompt|locating|located|denied`, `offline=1`, `off=1`, `own=1`, `sp=<area>`.

**Font:** Figtree only. **Theme:** dark unless localStorage `tb-theme` is `light`; OS preference only applies when JS is off.

## Motion grammar (all instant under prefers-reduced-motion)
| Trigger | Motion | Time / easing |
|---|---|---|
| Heart tap | scale .8 > 1.2 > 1, 3 small dots drift out and fade, fill turns rose | 360ms cubic-bezier(.3,1.5,.5,1); dots 500ms ease-out |
| Un-heart | shrink to .8 and back, picks row slides out | 260ms ease-out |
| Picks counter | digits roll, pill bumps to 1.18 | 300ms / 420ms |
| Sheet snap (peek/half/full) | 1:1 drag, rubber band, velocity-projected snap, no overshoot | 440ms cubic-bezier(.2,.9,.25,1) |
| Map fly-to (search pick, peek, area) | easeTo centre, zoom to 15 (areas 12 to 15) with sheet padding | 600 to 700ms |
| Pin appear | dots fade out 12.9 to 13.4, icons fade in 13 to 13.5, Michelin pins 9.5 to 10.3 (map-driven) | zoom-driven, no bounce |
| Locate | pulse ring 8 to 24px, 1.6s loop; button spinner .9s | static ring under reduced motion |
| Dense hint / offline pill / search pin chip | fade + 6px rise | 250 to 300ms |

## Synthetic or illustrative (all labeled in the UI)
- Michelin sample tags on Rintaro, Pho Momma (his note says Bib 2025), Ernest, San Ho Won; years are placeholders ("sample tags" label).
- "Sample Michelin place n": 300+ seeded points in SF, LA, NYC, Chicago, DC, Seattle, Tokyo, Paris, London ("Sample data" in peek). No real names or distinctions.
- "Sample: owner-added place" and "Sample: owner-added event" (New / Added Nov 24 / Zach's pick). New items float to the top of the feed in the demo; proposal only.
- Search areas (Mission District, Sacramento, 94110...) are real public names; the street address is an example string. Old Sacramento Waterfront keeps its approximate pin, disclosed.
- Distances use the map centre (or your position once located); sample picks in the board are real rows.

## Decisions folded in
Satellite dropped (no sat toggle or captures; map controls are Key, Locate, plus zoom on desktop). Basemap theme is written as Protomaps flavor objects in map-config.js `FLAVOR`; the mock still renders OpenFreeMap. Michelin layer is a vector `pmtiles://` source (mock feeds GeoJSON). Offline state and "Address search is offline right now" designed.

## Risks
1. Phone quick filters are two rows (toggles, then scrolling categories with a fade edge); Hide been and Clear are icon-only buttons with labels for screen readers.
2. The 28-row checklist is still long on a phone.
3. Sheet drag is tested with a mouse only; needs a real-device pass.
4. Pin images and the sprite must stay in sync (map-config reads glyphs from icons.svg markup).
5. Prototype tiles and fonts load from the network (unpkg, Google Fonts, OpenFreeMap); production self-hosts.
6. At z12 about 350 saved dots still read as a crowd; the hint chip and filters are the answer.
7. Stale `phone-satellite.png` and `desktop-satellite.png` from the earlier pass could not be deleted by me (delete check blocked); remove them.

## Review fixes (applied)
- tokens.css is the single colour source; categories.json hexes are read from it (shop, outdoors, activities, other now match); every white glyph disc is 4.6:1 or better.
- Hit areas are 44px or more via a centred ::after on chips, source toggles, Map/List, Filters, sort and the grab handle; visuals unchanged.
- Phone quick filters: row 1 My lists / Other lists / Michelin / Hide been (Clear pinned at the start when active), row 2 categories. Desktop keeps wrapped chips under quiet "Show" and "Categories" labels.
- Light map labels #6f5f80 on #f1effa (5.1:1) in FLAVOR, PALETTE and --map-label.
- Type scale 12/13/15/16/20 and up for text; 12px labels tracked .01em. Icon sizes still use font-size on the glyph box.
- Sheet: the list scrolls at half height (body is sized to the visible part), dragging from the header or grab still resizes, pointercancel, blur and lost capture end a drag, and grabbing mid-animation freezes at the current position.
- "Other lists" is the source name everywhere (toggle, Filters, Key); the per-row tag stays "Other list" on purpose, since it labels one place.
- Icon threshold is z13 (dots below, fade 13 to 13.5); ZOOM.iconIn in map-config.js.
