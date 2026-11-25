# Round 3 brief: refine A into the build-ready direction (task design-r1)

The owner picked round 2 variation **A, map first, subtle**. You refine it at full fidelity. You are the only designer this round, and the engineers (kotone-senior-web) build from what you hand over, so the build assets matter as much as the screens.

## Inputs
- Start from `docs/design/round-2/a-map-first/` (phone.html, desktop.html, states.html, icons.html, notes.md) in `/mnt/wsl/work/worktrees/travel-book-design-r1`. Copy it into `docs/design/round-3/` and evolve it there. Do not edit round 2.
- Read the round 2 shared brief (`.impeccable/mocks/travel-book/round-2/brief-shared.md`) for the data, truth rules, palette, craft floor, icons and map rules. All of it still holds unless overridden below.
- Product truth (UPDATED): `/home/sakiaya/projects/travel-book/PRODUCT.md` (main checkout).
- Data: `docs/design/round-2/_data/sample.json` (public export shape, real categories). Copy what you need inline.
- Load the impeccable skill (craft floor), the apple-design skill (sheets, springs, materials, typography, touch) and, for the colour key, the dataviz skill (categorical colours that hold in both themes AND on satellite).
- Screenshot helper: `node /tmp/claude-1000/-home-sakiaya-travel/dfd1d219-8da1-4b94-af85-e665af879cfb/scratchpad/design-r1/shot.mjs <html> <out.png> <w> <h> <light|dark> [full]`.

## What changed: the owner is now the primary user
It is Zach's own daily explorer for his saved places, the other lists and shows. A date or friends are secondary visitors who can heart and send picks. Mode: Operate. Speed, density for repeat use and scanability come before charm; the cute accents (icons, heart pop, warm palette, rounded shapes) stay, kept subtle.

## Must-haves
1. **Map first**, as in A: a full-bleed map with an Apple-Maps-style sheet (peek / half / full). Desktop is a full-bleed map with a floating left panel.
2. **Quick filters for daily use**, reachable without opening a sheet:
   - category chips (with icons; they double as the legend)
   - a My lists / Other lists toggle (both on by default)
   - "Hide been"
   - Region and the full 28-list checklist stay in the Filters sheet. Active filters show a count, and "Clear" is one tap.
3. **Search that jumps the map:** typing suggests places by name (and category matches); choosing one flies the map there and opens its peek. Also add a "Locate me" button (geolocation, which degrades gracefully) next to the map controls.
4. **Feed default sort is "Nearest to map center"**, with Mix and A-Z in the sort control. Rows show the distance from the map centre ("0.4 mi").
5. **"Been" state visible:** a small check badge on the pin and a "Been" tag on the row, quiet but clear. Only places whose data says been. In the sample only Old Sacramento Waterfront (approximate pin, disclosed). Show it in a state frame.
6. **Shows in one tap:** a top-level control always visible on phone (tab bar or a sheet segment) and on desktop.
7. **Hearts/picks are secondary but intact:** the heart on rows and the peek, a picks counter, the picks bottom sheet with Send to Zach and Copy as text, and a friendly empty state. Keep A's subtle heart pop and counter bump.
8. **Map style toggle: Standard / Satellite.** A small segmented control or layers button among the map controls.
   - Standard: the OpenFreeMap positron restyle (dark: plum; light: lavender-white).
   - Satellite: Esri World Imagery raster `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}` (max zoom 19), attribution "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community", with the OpenFreeMap road and place labels overlaid (hybrid). Keep USGS Imagery Only (`https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}`, public domain, US only, credit "USGS The National Map") as a documented alternative in the map config.
   - Pin icons and colours must stay legible on standard light, standard dark AND satellite: white ring plus a soft dark halo or shadow on satellite. Verify with screenshots.
9. **Theme: default dark** (his zachle.info default) when the visitor has no stored choice and no OS preference... Practically: dark unless the stored choice says light. Light fully supported. Toggle in the UI.
10. **One shared colour key and icon set** (24 categories plus UI icons):
    - Fix the ice-cream icon (it reads like a map pin): make it a cone with a two-scoop or swirl top and a clear waffle cone.
    - Check every icon at pin size for confusions (POI star vs tourist camera, trails vs hiking, shopping bag vs grocery basket).
    - Colours sit in his families: food rose, drinks violet, shopping mauve, sights slate lavender-blue, outdoors one muted green/teal, activities plum, logistics grey-lavender.
    - White glyphs at 3:1 or better on every disc, in both themes and on satellite.
11. **Dense SF at zoom 12-13, still no clustering:**
    - At low zoom, small dots in the group colour (radius scales with zoom).
    - The category icon appears at about zoom 13.5 and up. Reconsider the threshold, since 11.5 crowded.
    - Draw order: hearted, then his lists, then other lists, so the important pins stay on top. Labels only at high zoom with collision.
    - A gentle "Lots here. Filter or zoom in to see icons" hint chip when the in-view count is over about 250, dismissible, tapping it opens filters.
12. **AA contrast** everywhere. Filled buttons rose-600+ with white text (dark theme: rose-300/400 with dark text).
13. **"Other lists" naming**, never friends.
14. **Room for live owner-added content (Discord), placeholder only:**
    - Places and events the owner posts from Discord will merge into the feed and map from a live store. Design how one such item looks: a small "New" or "Added Nov 24" badge on the row and peek, and an event from the owner appearing alongside 19hz shows with a small "Zach's pick" mark.
    - Show it in ONE state frame using a clearly labeled synthetic sample ("Sample: owner-added place"). No other UI now.

## Deliverables in `docs/design/round-3/`
- `phone.html` (390x844, every state reachable by tapping) and `desktop.html` (1440x900).
- `states.html` + `phone-states.png`, a board of phone states:
  - dark landing
  - light landing
  - satellite with pins
  - search suggestions open
  - filters sheet
  - pin peek with been
  - dense zoom-12 with the declutter hint
  - picks sheet
  - shows
  - the owner-added sample
- Screenshots: `phone-dark.png`, `phone-light.png`, `phone-satellite.png`, `desktop-dark.png`, `desktop-light.png`, `desktop-satellite.png`. Look at every one.
- `icons.html` + `icons.png`: the shared set at pin size on standard light, standard dark and satellite, plus 48px and the Key.
- Build assets the engineers lift directly:
  - `build/tokens.css`: every colour, type, space, radius, shadow and motion token as custom properties, with `:root` light, `prefers-color-scheme: dark` guarded by no stored choice, and `[data-theme=dark]`, matching the DESIGN.md token names where they exist (`--bg --surface --surface-2 --ink --ink-2 --muted --line --accent --accent-ink --accent-soft --focus ...`) plus new ones (category colours `--cat-food` etc., map tokens).
  - `build/icons.svg`: an SVG sprite, one `<symbol id="i-...">` per icon, `currentColor` strokes.
  - `build/categories.json`: category → group, icon id, colour token, label.
  - `build/map-config.js`: a commented ES module with the standard light/dark restyle (layer id → paint), the satellite source and label overlay, the pin layers (circle low zoom, symbol from the threshold, been badge, hearted halo, sort keys), and the attribution strings.
- `notes.md` (short): font, motion grammar for the heart pop, counter bump, sheet snap, map fly-to and pin appear (trigger, motion, duration/easing, reduced-motion fallback), synthetic items, risks.

## Rules
Write only inside `docs/design/round-3/`. No commits, nothing in `src/`. Real data only; synthetic samples labeled. Report in under 12 lines.

## Added: Michelin filter (owner, mid-round)
- Places carry Michelin distinctions from the 2022-2026 editions: 1/2/3 Stars, Bib Gourmand, Green Star, Selected. The real data (michelin.json) is not ready. Use these SAMPLE tags, labeled "sample" in notes.md and in the states board caption: Rintaro (Bib Gourmand), Pho Momma (Bib Gourmand 2025; his own note says so), Ernest (Star), San Ho Won (Star). Do not state years or star counts for Rintaro, Ernest or San Ho Won as fact. Show them as "Michelin Star (sample)" or with a placeholder year that is clearly marked sample in notes.
- Quick-filter chips: "Michelin stars" and "Bib Gourmand", plus in the Filters sheet a Michelin section with Stars / Bib Gourmand / Green Star / Selected and a "Recognized any year (2022-2026)" vs "Current edition" option.
- A small badge on the pin (a tiny corner mark at high zoom only) and on the peek card showing the most recent distinction and year, e.g. "Bib Gourmand 2025".
- The full place card lists every distinction by year.
- Do NOT reproduce Michelin's trademarked logos (the Michelin star flower, the Bibendum face). Use your own neutral drawn mark (e.g. a small rosette/award icon in the icon set) plus the words. No emoji.
- Include a "Michelin" state in the states board (chip active, badges visible).

## Added: Michelin as a US-wide layer (owner, mid-round)
- Besides badges on his saved places, all US Michelin restaurants 2022-2026 (about 1,000+) are a separate browsable layer, including ones he has not saved.
- Source control becomes three toggles: My lists / Other lists / Michelin (Michelin off by default; it is a layer he turns on). Keep the Michelin stars / Bib chips from before; with the layer off they filter his saved places, with it on they also filter the layer.
- Unsaved Michelin pins are visually distinct from saved places: e.g. an OUTLINE disc (ring in the Michelin accent colour, transparent/ground-tinted centre, award glyph) vs saved places' filled category discs. A saved place that is also Michelin keeps its filled category pin plus the small award badge. Must read on standard light/dark and satellite.
- Performance and zoom: no clustering. At national zoom (z3-6) unsaved Michelin points are tiny dots (radius ~2px); they grow with zoom and become outlined award pins at city zoom. Saved places always draw above the layer.
- The real data is not ready. Do NOT invent real restaurant names or distinctions. For the layer demo use clearly synthetic points: names "Sample Michelin place 1..n", placed in a few US metros (SF, LA, NYC, Chicago, DC, Seattle) and labeled "Sample data" in the UI caption of that state and in notes.md. Saved-place badges keep the samples given earlier.
- States board: add "Michelin layer on, national zoom" and "Michelin layer on, city zoom (outline vs filled)". Desktop: one capture with the layer on is enough (desktop-michelin.png).
- map-config.js: add the michelin source and layers (dot at low zoom, outline symbol at city zoom, sort keys under saved pins).

## Updated: Michelin is WORLDWIDE (~15-20k) and must not lag (owner)
- Supersedes "US-wide": the layer covers the world. Synthetic demo points may now also sit in a few world cities (Tokyo, Paris, London) besides US metros; still "Sample Michelin place n", labeled sample.
- Performance architecture (the director writes it into HANDOFF.md; keep your design consistent with it):
  - MapLibre GL only (GPU circle + symbol layers, icon sprite), never DOM markers. No clustering.
  - Michelin data ships as vector tiles (one PMTiles file via HTTP range requests), fetched only for tiles in view and only after the layer is switched on. Tile features carry minimal properties: `id`, `best` (best award code: 3s|2s|1s|bib|green|sel), `yr` (latest year), `name` (for labels at high zoom). Full awards-by-year load on tap from a per-id lookup.
  - Low zoom: tiny dots coloured by best award only (define an award colour scale: stars, Bib, Green Star, Selected; distinct but in-family, legible on all three basemaps). Award icons/outline pins and badges appear from about zoom 9-10.
  - His saved places (~2k) are one compact GeoJSON.
- In map-config.js: michelin source as `{ type: 'vector', url: 'pmtiles://michelin.pmtiles' }`, source-layer `michelin`, with the dot layer (z0-9.5) and outline-symbol layer (z9.5+), filter expressions for the chips (best award, recognized-any-year vs current), sort keys below saved pins. Note the pmtiles protocol registration in a comment.

## Added: location features (owner)
1. Locate me (map control): tap asks for permission only then; states to design: idle, locating (button spinner + "Finding you…" toast), located (map centres on him, pulsing dot with an accuracy halo, feed re-sorts by distance from HIM, rows show distance; a small "Sorted by distance from you" note), denied (friendly toast/card: "Location is off. You can still search or move the map." with how-to, dismissible). Position never leaves the browser: say so in a tiny line on the first prompt card.
2. Search by area or address in the same box. Results grouped in this order with small section labels in sentence case: Saved places + Michelin names (with their icons), Areas (neighbourhoods, cities, zips; area icon), Addresses (pin icon). Picking a result flies the map there; areas/addresses drop a temporary search pin (distinct from place pins: a simple outlined teardrop in ink colour) with a dismiss "x". Geocoder attribution line at the bottom of the results ("Search by Photon · © OpenStreetMap").
- Show these states in phone states board AND desktop: idle, locating, located, denied, search with mixed result types. (Desktop: produce desktop-search.png and desktop-located.png.)
- Geocoder results in the mock are illustrative: use real public place names (e.g. "Mission District, San Francisco", "Sacramento, CA", "94110") and a plausible street address string marked as example in notes; never invent places he saved.

## Updated: no third-party services (owner decision)
- Basemap in production = self-hosted Protomaps PMTiles (regional extract in his R2). Keep the prototype rendering on OpenFreeMap (we cannot host Protomaps in a mock), but write the theme in map-config.js as Protomaps basemap FLAVOR colour objects (`@protomaps/basemaps` custom flavor: background, earth, water, park/landcover, roads by class, buildings, labels/halo) for light and dark, plus a short mapping note from your OpenFreeMap restyle to those flavor keys. Attribution string in the mock: "© OpenStreetMap contributors · Protomaps".
- Search: no Photon/komoot credit. Results come from a built-in index (saved places, Michelin names, gazetteer of cities/neighbourhoods/ZIPs) plus addresses from the owner's own geocoder. Design one extra state: addresses unavailable, i.e. search still shows places and areas with a gentle line "Address search is offline right now" in the Addresses group. Footer line under results: "© OpenStreetMap contributors · GeoNames" (or drop the footer if it crowds; attribution then lives in the map credit).
- Satellite: keep the toggle and the satellite frames, but label the Satellite option "Satellite (preview)" in the mock and note in notes.md that it is pending an owner decision (external imagery provider or drop).

## Updated: satellite DROPPED, home backend, offline resilience (owner decisions)
- Remove the Standard/Satellite toggle and every satellite frame/capture (phone-satellite.png, desktop-satellite.png, the satellite state). The map style simply follows light/dark. Map controls are now Key and Locate me (plus zoom on desktop). Pins only need to read on standard light and dark; drop satellite rows from icons.html.
- Dynamic things live on the owner's home backend behind a tunnel; static fallbacks keep the site working when it is down. Design ONE "offline" state (phone; desktop optional): the home box is unreachable, the map still shows (a coarser static basemap at low zoom), saved places and Michelin still work, search shows places/areas, and a gentle one-line note appears (e.g. a small pill under the search bar: "Some live bits are offline. Saved places still work."), plus the Addresses group line "Address search is offline right now". Not alarming, dismissible.
