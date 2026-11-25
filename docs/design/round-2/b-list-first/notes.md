# Variation B: List first, a bit more playful

Data: `docs/design/round-2/_data/sample.json` (real categories, 971 places after dropping 17 names with scrub artefacts). Inlined. Old Sacramento Waterfront (curated, been) is the only extra; its pin is approximate (Sacramento picks) and the detail sheet says so.
Wording: "My lists" / "Other lists" (SF list, Sac list, Bay Area list, NYC list). Source is a toggle, not a category. Other lists start off.

Font: Nunito (500-900), also for the wordmark.

Icons (authored SVG, 32 grid, 2.1-2.5 stroke, round joins, soft fill): one per category, 24: casual food (fork), sit down (cloche), breakfast/brunch (mug), fine dining (wine glass), bakery (croissant), desserts (ice cream), tea/drinks (boba cup), bar/club (cocktail), shopping (bag), clothing (hanger), grocery (basket), points of interest (star), tourist attractions (camera), museums (columns), venues (music note), roadside (sign), parks (tree), hiking (boot), trails (dotted path), activities (sparkle), sports (ball), guns (target), hotels (bed), parking (P). UI: map, list, filter, heart, share, copy, music, close, search, moon, sun, check, chevron, pin, external, key. `icons.html/png` shows every icon at pin size and 48px, light and dark, plus the key.

Layout: one continuous feed (loads 40 at a time). The 8 big tiles (Food, Sweets, Boba & tea, Drinks, Shopping, Sights, Parks, Fun) are multi-select toggles: selected = solid group colour + check badge. Hotels and parking lots are reachable in Filters (all 24 lists + the 4 other lists, region, hide been). Search narrows the same feed. On the phone map the same toggles become pills under the Filters and Key chips. Moving the map narrows the list ("N places in this area", "Show everything" clears).

Map: MapLibre 4.7.1 + OpenFreeMap positron restyled calm. No clustering. Below zoom 11.5 a small group-coloured circle; from 11.5 a symbol layer (disc with the category icon drawn to a canvas, `addImage`, overlap allowed); name labels from zoom 14. Picked places carry a tiny heart badge. Tap/click a pin: selection ring plus a peek card (name, category label, Zach's note, heart). Swipe the peek sideways to step through the 9 nearest places, the map follows; on the phone tapping the card opens the detail sheet. Desktop: hover shows a tooltip and highlights the list row.

Motion grammar (all `prefers-reduced-motion`: instant state change, no animation)
- Heart tap: icon scale 1 > 1.3 > .92 > 1.06 > 1, 420ms; 6 tiny hearts burst up and fade, 760ms ease-out, staggered 18ms. Un-heart: 1 > .78 > 1, 240ms. Fallback: fill colour only.
- Picks counter: FAB (and desktop button) wiggles +-14deg with a 1.14 scale, 560ms; number rolls (old slides out, new slides in), 300ms ease-out-expo. Badge scales in from 0 on the first pick.
- Group tiles: press squishes (1.06 x .9, 80ms), release springs back, 350ms; selected check pops in.
- Sheets: translateY 450ms cubic-bezier(.32,.72,0,1), grabber drag with velocity dismiss; Shows slides in from the right and leaves to the right.
- Map reveal: pins fade in 700ms (circle/icon opacity). The brief's "staggered drop" is not done on WebGL layers (a per-pin stagger would need markers); chose smoothness for 971 pins.
- Feed rows rise 8px with a 28ms stagger on the first 8 rows after a filter change.

Synthetic: nothing invented. Picks share link and "Copy as text" are real (Web Share, clipboard fallback). Screenshot presets use the URL hash (`#p=Name|Name`, `#s=filters|detail|picks|shows|key`, `#v=map`, `#sel=Name`, `#o=1`, `#c=boba,sweets`, `#t=dark`).

Risks
- Tap targets: tile squares are 62px but the label row is part of the button; chips on the map pills are 44px high.
- Pin icons at 26px are readable but dense downtown (overlap allowed by design); at zoom 12 hundreds of discs touch. The Key chip and peek category label carry the meaning.
- 8 tiles cover the main kinds, so "Hotels" and "Parking" only live in Filters.
- Marker drop is a fade, not a bounce.
- The map needs network for tiles and the OpenFreeMap style; offline it falls back to the plain lavender ground with pins.
- Region is derived from coordinates (San Francisco, Bay Area, San Jose, Sacramento, New York), not from the address.
