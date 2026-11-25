# A: Map first, subtle accents

Data: `docs/design/round-2/_data/sample.json` (real categories, 945 unique pins after de-duping repeats). No clustering: every place is its own pin.

**Font:** Figtree (one family). **Palette:** mauve/lavender surfaces and plum controls; rose only on hearts, the picks counter and primary actions (Show N places, Send to Zach, Heart it). Category colours follow the brand palette: Food rose-600, Drinks violet-lavender, Shopping mauve, Sights slate blue, Outdoors muted teal-green, Activities plum, Hotels and parking grey-lavender, with the white icon inside.

**Icons (24, one per list, plus UI set):** Breakfast/Brunch (fried egg), Casual Food (fork and knife), Sit Down (plate and cloche), Fine Dining (wine glass), Bakery (croissant), Desserts (ice cream cone), Tea/Drinks (boba cup with pearls), Bar/Club (cocktail), Shopping (bag), Clothing (hanger), Grocery (basket), Points of Interest (star), Tourist Attractions (camera), Museums (landmark), Venues (music note), Roadside (road sign), Parks (round tree), Hiking (boot), Trails (path), Activities (sparkle), Sports (ball), Guns (target), Hotels (bed), Parking (P). UI: map, list, filter, heart, share, copy, shows, close, search, moon/sun, chevrons, check, external link, key. See `icons.html` / `icons.png`.

**Map pins:** one GeoJSON source, no cluster. Below z11.2 a small group-coloured circle; from z11.2 a symbol layer (canvas-drawn disc plus icon registered with `addImage`), size grows with zoom, labels from z14.4. Selected pin gets a halo and larger icon; hearted pins get a small rose heart badge. "Key" chip opens the legend; filter chips use the same icons.

**Motion grammar** (all become instant state changes under `prefers-reduced-motion`)
| Trigger | Motion | Time / easing |
|---|---|---|
| Heart tap | icon scale .8 to 1.2 to 1, 3 tiny dots drift out and fade, fill turns rose | 360ms spring-ish cubic-bezier(.3,1.5,.5,1); dots 500ms ease-out |
| Un-heart | soft shrink to .8 and back; row in picks sheet slides out | 260ms ease-out |
| Picks counter | digits roll up, pill bumps once to 1.18 | 300ms / 420ms ease-out |
| Sheet drag | 1:1 tracking, rubber band past ends, momentum-projected snap (peek, half, full), grab mid-flight | 440ms cubic-bezier(.2,.9,.25,1), no overshoot |
| Peek card | slides up; swipe sideways moves to the next nearby place (list of 12 closest) | 420ms / 260ms same curve |
| Pins | fade in with zoom (z11.2 to 11.9), no bounce | map-driven |

**Behaviour:** the list is the one continuous feed of places in the current map area, nearest the centre first, 120 at a time. Filters: My lists / Other lists toggle pair, category chips, 28-list checklist under group headers (Hotels and Parking Lots included), region, hide places I've been, sticky "Show N places". Share link is `#picks=ids`; Web Share with copy fallback. Preset states for the board: hash `s=filters|peek|picks|shows|legend`, `t=dark`, `p=<name>`, `pk=<names joined by ~>`, `sh=full`.

**Synthetic / caveats:** none invented. Picks in `phone-states.png` and the "Kiss of Matcha" peek are real rows picked for the screenshot. List-checklist counts are counts of places in the sample, not the full lists. Region is derived from coordinates. Only Old Sacramento Waterfront is marked "been" (from curated data).

**Risks:** (1) ~950 overlapping pins in the dense SF core read as a crowd at z12-13; legibility depends on zooming in. (2) Sheet drag is pointer-event code tested with mouse only, needs a real-device pass. (3) Canvas-drawn pin images need the glyph set kept in sync with the SVG sprite. (4) The 28-row checklist is long on a phone.
