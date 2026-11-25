# Variation C: map and list together, tab bar, medium accents

Font: Figtree (one family, wordmark included). Data: round-2 `_data/sample.json`, inlined. Pins: MapLibre 4.7.1 + OpenFreeMap positron, restyled calm; no clustering, GeoJSON source drawn as `circle` dots below zoom 11.5 and `symbol` pins (category icon in a group-colour disc, added via `addImage`) from 11.5, name labels from 14.4.

## Icons (24 categories, one each, group colour)
Breakfast/Brunch mug, Casual Food fork+knife, Sit Down cloche, Fine Dining wine glass, Bakery croissant, Desserts cone, Tea/Drinks boba cup with pearls, Bar/Club coupe, Shopping bag with heart, Clothing hanger, Grocery basket, Points of Interest star, Tourist Attractions camera, Museums columns, Venues ticket, Roadside sign, Parks round-crown tree, Hiking boot, Trails dotted path, Activities sparkle, Sports ball, Guns target, Hotels bed, Parking P. UI: map pin, list, filter, heart, share, copy, music, close, search, sun, moon, key, expand, shrink, external, heart-seal (Send button). See `icons.html` / `icons.png`.

## Motion grammar
| Moment | Trigger | Motion | Time / easing | Reduced motion |
|---|---|---|---|---|
| Heart pop | tap heart | scale .8 > 1.25 > 1, ring ripple, 5 small hearts drift up and fade | 360ms spring-ish cubic-bezier(.3,1.5,.5,1); burst 620ms | instant fill, no burst |
| Un-heart | tap filled heart | soft shrink .78 > 1 | 240ms ease-out | instant |
| Picks badge | picks count changes | badge bumps 1.35, number rolls (up on add, down on remove), tab heart wiggles | 360-500ms | instant number |
| Marker drop | filter change, first load | dots/pins fade in while dropping 10-12px | 520ms ease (map paint transition) | instant |
| Map card collapse | list scrolls past 30px | card 240 > 56px strip, hello line folds away | 400ms cubic-bezier(.2,.8,.2,1) | instant |
| Full map / sheet | Expand, strip tap | card fills the view, list becomes a draggable sheet (peek / open) | 450ms spring-ish, drag follows finger | instant |
| Sheets (filters, detail, key) | open / swipe down | slide from bottom, scrim fades | 450ms | instant |
| Peek card | tap pin | slides up; swipe sideways moves between the 10 nearest places and the map follows | 350ms | instant |

## Behaviours worth knowing
Moving the map sets "N places in this area" and adds a removable "Map area" chip. Any filter change clears it. List is one continuous feed with no sections (loads 60 at a time). Category chips are on the map card, in the filter sheet and as removable chips above the list. Picks: Web Share, copy fallback, "Copy as text". Preset states for screenshots: `phone.html?state=filters|detail|picks|shows|full|collapsed|key|peek&theme=dark&picks=5`.

## Synthetic / approximated
Shows are the snapshot rows as given. Old Sacramento Waterfront has an approximate pin (38.5844, -121.5043), labelled "Pin is approximate, labeled as a Sacramento pick" in its detail; "Sacramento picks", "Bay Area picks", "Seattle picks" are the curated entries and have no coordinates, so they appear in the list only ("Not pinned on the map yet"). Share link host is a placeholder when opened from file://. Picks used in the states board are the first places in the sample, not real hearts. Region for the New York pins is derived from coordinates.

## Risks
1. Density: ~490 icon pins at zoom 12 overlap in the Mission/SoMa; reads fine with allowed overlap but the 240px card is busy until she filters or zooms.
2. The collapse-on-scroll plus full-map sheet is the most custom piece (two layout modes, drag handling); needs real-device tuning, especially iOS rubber-banding.
3. 24 category chips in a scroll row asks for horizontal scanning; the Key and the filter sheet carry the full list.
4. Notes show as Zach's words, including short ones like "8.4" that read oddly without context.
