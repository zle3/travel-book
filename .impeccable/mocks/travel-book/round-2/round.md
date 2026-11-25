# Round 2 (branch): clean, minimal, cute accents

Task design-r1 · director kotone-design-director · 2026-11-24
Status: 3 variations built and reviewed; overview docs/design/round-2/index.html; waiting on owner.

## Brief from the owner
- Clean, minimal, highly usable app UI; cuteness only from accents (custom group icons, micro-animations, warm palette, rounded shapes, friendly copy). Concept motifs at most as tiny touches.
- No clustering: every place its own pin at every zoom; one continuous feed; moving the map updates the list; pin tap opens a peek card; swipe between nearby places; filter chips toggle on the map.
- "Other lists" (never friends), source toggle "My lists / Other lists"; other-list places categorized into his categories (real file pending; prototypes use a few provisional categories).
- Readable pins: category icon inside each pin from about zoom 11.5, group colour below that; always-reachable Key legend; filter chips reuse the icons; icon sheet per variation.
- Carry-overs: rose-600+ under white text (AA); scrubbed sample data; real data only.
- Craft bar (standing exit rules): a top-tier consumer iOS app (Apple Maps sheet, Airbnb wishlists), executed straight, no smuggled concept chrome.

## Variations (docs/design/round-2/<slug>/), each changes layout and accent level
- A `a-map-first`: map-first, subtle accents.
- B `b-list-first`: list-first, playful accents.
- C `c-hybrid`: map card above the list with a tab bar, medium accents.

## Director review
- All: dedupe (accent-insensitive name within 60 m, lists merged); the two Taqueria El Farolito entries are real separate branches and stay, with the street shown. Default feed order "Mix" (noted places first, round-robin across categories) plus Sort (Mix / Nearest / A-Z), so the first screen is not all forks.
- A: group colours drifted to terracotta/olive; re-keyed to the brand families. Stray "Filters 1" default removed.
- C: Shopping in amber re-keyed to mauve, Sights to slate lavender-blue. In-card peek slimmed to one line.
- B: per-tile filters confirmed as toggles over one feed. Marker drop is a fade, not a bounce, for smoothness with about 950 pins.
- Open for round 3/build: one shared colour key and icon set (owner may mix: e.g. B's icons + C's layout); pin crowding at zoom 12-13 in dense SF (no clustering by owner rule; consider collision-free label priority, slightly smaller discs at z12).

## Owner's choice
(pending)
