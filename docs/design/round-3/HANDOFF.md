# Little Travel Book: build handoff (round 3, direction A refined)

For kotone-senior-web. Status: reviewed (kotone-reviewer, round 3; blockers and majors addressed), awaiting the owner's sign-off on round 3. Nothing here is built yet.

Approved composition: `phone.html`, `desktop.html` and `states.html` in this folder (open them, every state is tappable). Build assets to lift: `build/tokens.css`, `build/icons.svg`, `build/categories.json`, `build/map-config.js`. Product truth: `PRODUCT.md`. Design rules: `DESIGN.md`, which the documenter rewrites at finish from what ships.

## 1. Scope and mode
- One route (`/`), the explorer: map, sheet/feed, filters, search, peek, place card, picks, shows. Mode Operate. Primary user: the owner, daily on phone and desktop. Secondary: a visitor who hearts places and sends picks.
- Dark by default (no stored choice → dark); light fully supported; toggle stored under a project-prefixed `localStorage` key and applied before first paint (the starter already has this mechanism).

## 2. Regions (phone 390x844)
1. Map (full bleed, MapLibre).
2. Top bar: search (suggestions; choosing one flies the map there and opens the peek) and Filters with an active count.
3. Quick chips row: category chips with icons (these double as the legend), My lists / Other lists / Michelin source toggles, Hide been, Michelin stars and Bib Gourmand.
4. Map controls (right): Key, Locate me (zoom buttons on desktop).
5. Sheet (peek / half / full): Map|List toggle, "N places in this area", Sort (Nearest default · Mix · A-Z), and the feed rows (icon disc, name, category · area · distance, Zach's note, Been tag, Michelin badge, heart).
6. Peek card (on pin tap): name, category, distance, note, badges, heart, Open in Maps. Swipe moves to nearby places.
7. Place card (full): adds the address, all lists it is on, and the Michelin distinctions by year.
8. Tab bar: Places, Shows, Picks (count).
9. Picks sheet: list, Send to Zach (share link encoding ids), Copy as text, empty state.
10. Shows: 19hz.info listings by region and date with search; owner-added events marked "Zach's pick".
11. Declutter hint chip when more than about 250 places are in view.
Desktop 1440x900: a full-bleed map, with a floating left panel holding regions 2, 3, 5, 6 and 7, and Shows, Picks and theme at the top right.

## 3. Tokens, type, icons
- **Tokens:** `build/tokens.css` is the single source; copy it into `src/styles/` as the `:root` block plus the two identical dark blocks (DESIGN.md rule). It keeps the starter names (`--bg --surface --surface-2 --ink --ink-2 --muted --line --accent --accent-ink --accent-soft --focus`, type scale `--fs-xs…--fs-2xl`, `--space-1…7`, radii, shadows, `--ease --t-fast --t-base`) and adds `--accent-soft-ink`, `--radius-lg --radius-pill --tap`, `--ease-pop --ease-out --t-sheet --t-pop --t-fly`, the category colours `--cat-*`, the award colours and the map tokens.
  - Light: ground `#f6f5fb`, ink `#3b2832`, accent rose-600 `#e11d48` with white text (4.7:1).
  - Dark (default): ground `#1e1520`, surface `#2b1e29`, ink `#f6ecf2`, accent rose-400 `#fb7185` with dark ink `#3b0a17` (6.3:1).
- **Theme rule:** dark unless `localStorage['tb-theme'] === 'light'`, applied before first paint. The `prefers-color-scheme` block only matters with JS off.
- **Type:** Figtree, one family, self-hosted (woff2, weights 400/500/600/700, latin subset) with `font-display: swap`. Scale: `.75 / .8125 / .9375 / 1 / 1.25 / 1.5 / 2 rem`, line-height 1.4. Tabular numerals for distances and counts. Map labels use self-hosted glyph PBFs (Noto Sans from the Protomaps basemaps-assets), not Figtree.
- **Icons:** `build/icons.svg` is an SVG sprite of 55 symbols with `currentColor` strokes: 24 category icons, an Other-lists icon, award, area and search-pin icons, and UI icons. Use them in the DOM via `<svg><use href="/icons.svg#i-…"/></svg>`. Map pins are rasterised from the same symbols (see `map-config.js`), so the map and the UI never drift. Drop the unused `satellite` symbol and the stale satellite comments in the build files: satellite was cut.
- **Categories:** `build/categories.json` maps each of the 24 categories to its group, icon id, colour token and label. Group colours:
  - Food: rose
  - Drinks: violet
  - Shopping: mauve
  - Sights: slate lavender-blue
  - Outdoors: muted green
  - Activities: plum
  - Logistics: grey-lavender

  Award colours (Michelin layer): Star amber, Bib teal-blue, Green Star green, Selected stone. Every ring is 4.5:1 or better on white, and pins sit on a white halo.
- **Map config:** `build/map-config.js` (ES module) holds:
  - the Protomaps `FLAVOR` objects for light and dark
  - the saved-places sources and layers: dots below about z13.5, icon symbols above, the been badge, the hearted halo and sort keys
  - the Michelin vector source and layers (dots z0-9.5, outline award pins z9.5+, chip filter expressions)
  - the locate dot, accuracy halo and search-pin helpers
  - the attribution strings
  
  The mock renders OpenFreeMap; production swaps in the Protomaps sources from §5.

## 4. Data
- **Saved places** (his lists + Other lists, about 2k): built at deploy time into one compact GeoJSON (`/data/places.geojson`; short property keys; served gzip/brotli with a long cache and a content hash in the filename). Properties: `id, n (name), c (category id), s (source: m|o), l (list ids), note, been, addr, maps, mich (latest distinction code + year, if any)`. Duplicates are merged: an accent-insensitive name match within 60 m merges the entries and unions their lists.
- **Michelin worldwide** (about 15-20k): see §5. Never shipped as one JSON blob.
- **Shows**: Worker endpoint, cached for about 1 hour (exists in the plan; credit 19hz.info).
- **Live owner-added content (Discord)**: later. It merges at read time from the home backend's SQLite (`GET /v1/live`, see §5b); when home is offline, it is simply absent and the offline note shows. Leave room for it: feed rows, peek and shows accept `origin: "live"` items with an `added` date, and render the "New · Added <date>" badge and the "Zach's pick" mark (see the states board's sample). There is no other UI now.

## 5. Performance architecture (owner requirement: must not lag)
- **Map engine:** MapLibre GL JS (WebGL). Every pin is a GPU `circle` or `symbol` layer drawn from a sprite (icons rasterised once at 2x via `addImage`, or a prebuilt sprite sheet). No DOM markers. No clustering, ever.
- **Saved places:** one GeoJSON source (`cluster: false`). At low zoom, small group-coloured circles (radius interpolated by zoom); from about z13.5, symbol pins with the category icon; labels only at high zoom, with collision. `symbol-sort-key`/draw order: hearted, then his lists, then Other lists.
- **Michelin layer:**
  - The build converts `places/michelin-world.csv` into **zoom-bucketed static PMTiles** (tippecanoe; points only; no dropping or clustering), for example `michelin-z0-8.pmtiles` (properties `id, best`) and `michelin-z9-14.pmtiles` (properties `id, best, yr, name`). Each file is under the **25 MiB** Workers asset limit (20k points is far below that). They are served as **static assets** (so they work offline) and read with range requests through the `pmtiles` protocol (`pmtiles` JS, about 8 KB gzip).
  - Off by default: the Michelin source and its tiles are not added or fetched until the toggle is switched on. The `pmtiles` protocol itself registers at map init, because the static fallback basemap (below) is PMTiles too.
  - z0-9.5: tiny dots coloured by best award only. z9.5+: outline award pins (unsaved) and badges. Saved places that are also Michelin keep their filled category pin plus a small award badge, and draw above the layer.
  - On tap, the awards-by-year load from a static per-id lookup: `michelin/details/<2-hex-prefix>.json` shards (256 files, a few KB each).
- **No third-party runtime services, and no Cloudflare D1/KV/R2 (owner decisions).** Cloudflare Workers serves only the static site plus a thin proxy. Everything dynamic lives on the owner's **home backend** (Docker, behind his Cloudflare Tunnel, e.g. `api.travel.zachle.info`). The site must keep working when that box is down (see "Offline resilience").
- **Basemap:**
  - **Primary:** Protomaps vector tiles served by the home backend's PMTiles tile server from a regional extract (Bay Area, Sacramento, Seattle and NYC metros, up to z15). Responses carry long `Cache-Control` (`public, max-age=2592000, immutable` on versioned paths) so Cloudflare's CDN serves repeats without touching home.
  - **Static fallback, always shipped as Workers static assets:** a small low-zoom basemap, so the map never goes blank: world z0-5 plus the covered regions z6-10, as PMTiles, each file under **25 MiB** (measure with `pmtiles extract --maxzoom`; split by region if needed). The style has two sources with the same Protomaps schema: `base-static` (the static PMTiles, maxzoom 10) and `base-home` (the home tile server, minzoom 10).
    - **Every basemap layer is declared twice:** once on `base-static` with no maxzoom, so it overzooms and keeps rendering above z10, and once on `base-home` drawn on top. When home tiles load they cover the static ones. When they fail, the overzoomed static layers stay visible, so the map is never blank, only coarser.
    - Generate both layer sets from `@protomaps/basemaps` with the same flavor, prefixing ids (`s-…` and `h-…`).
    - **Tile errors:** listen to `map.on('error')` for `base-home` source errors. Three or more failures within 30 s, or a failed `/api/health`, set the offline state: the pill appears, and the `base-home` source is removed until the health check passes again, so no failing requests repeat.
  - Style: `@protomaps/basemaps` with custom light and dark **flavors** (`build/map-config.js`). Glyph PBFs and the sprite ship as static assets.
  - Attribution: "© OpenStreetMap contributors · Protomaps".
- **Satellite: dropped (owner decision).** There is no style toggle; the map follows light/dark.
- **Static PMTiles over Workers assets:** verify that Workers static assets honour `Range` requests. If they don't, the thin proxy route `/tiles/static/*` reads the asset via `env.ASSETS.fetch` and returns the requested byte range, with edge caching. Keep each file under the 25 MiB asset limit and the deployment under the asset file-count limit, which is why we use a few PMTiles files rather than thousands of z/x/y files.
- **Offline resilience (required):** if `api.travel.zachle.info` is unreachable (a health check with a 2 s timeout, re-checked every 60 s while the tab is visible):
  - These still work, because they are static: saved places, Michelin tiles and the Michelin and gazetteer search, plus the low-zoom basemap. The map stays usable, with coarser detail above z10.
  - Live owner adds and address search are hidden or disabled with a gentle note: a dismissible pill, "Some live bits are offline. Saved places still work.", and "Address search is offline right now" in the search Addresses group (see the states board). There are no error modals.
- **Budgets:**
  - First load: 300 KB of JS gzipped or less, counting everything fetched before the map is interactive (the app chunk plus MapLibre plus the `pmtiles` protocol). The search library, Michelin and other lazy chunks are measured separately and excluded. MapLibre 4.7.1 is about 211 KB gzipped (5.x about 248 KB), so pin 4.7.x or keep the app code under about 60 KB. Load it via dynamic import right after the shell paints.
  - LCP under 2.5 s on a mid-range phone. The shell (top bar, chips, sheet with the first rows for the default view) is server-rendered static HTML, so LCP does not wait for WebGL.
  - 60 fps panning with the Michelin layer on.
  - The places GeoJSON is about 150 KB gzipped or less.
- **Location (Locate me):** the browser Geolocation API runs on tap only (never on load). The position stays in memory in the browser: it is never sent to the Worker, the geocoder or any log, and it is not persisted. A GeoJSON source holds the dot and the accuracy circle (radius in metres converted to pixels per zoom), with a pulse via a `circle-radius`/`circle-opacity` animation on a second layer; reduced motion shows a static halo. When located, the feed sorts by distance from the user, and the "Sorted by distance from you" note is shown. States: idle, locating (with a timeout of about 10 s), located, denied/unavailable (a friendly card; search and panning still work).
- **Search (places, areas, addresses):** one box, three result groups in this order:
  1. Saved places and Michelin names.
  2. Areas (neighbourhoods, cities, ZIPs).
  3. Addresses.
  - **Built-in index, shipped as static assets and searched in the browser.** Groups 1-2 need no network beyond these static files. At build time, make compact prefix/fuzzy indexes:
    - `search/places.json`: his saved places, built with the places GeoJSON.
    - `search/michelin-names-<shard>.json`: Michelin names sharded by a hash of the folded name (for example 64 shards; first-letter sharding breaks for non-Latin names). Each record holds `id`, the display name, the folded and transliterated key, and lat/lng. The shards are lazy-loaded the first time the query is long enough or the layer is on.
    - `search/areas.json`: a gazetteer of cities and neighbourhoods from GeoNames (cities1000 + admin/neighbourhood features for the covered regions) and US ZIP centroids from the Census ZCTA gazetteer, downloaded once at build time and trimmed to name, kind, lat/lng and bbox.
    - Matching: a normalised (accent-folded, lowercased) prefix trie or sorted array, plus a small fuzzy pass (edit distance 1 on tokens of 4 characters or more). Scope the gazetteer to the covered metros (Bay Area, Sacramento, Seattle, NYC): their cities, neighbourhoods and ZIP centroids only, not all 33k US ZIPs. **Measure** the result: the target is about 60 KB gzipped for places plus areas, loaded on first focus of the search box. If it is over, split areas into a separate lazy file per metro. The lazy-load can use a library such as MiniSearch or FlexSearch (bundled, about 7 KB) or be hand-rolled.
  - **Addresses** go to the owner's **self-hosted Photon** (Docker on his home server, regional OSM extracts, reachable only through his Cloudflare Tunnel). The browser calls the Worker at `/api/geocode?q=`; the Worker forwards to the tunnel hostname with a shared secret header (Worker secret), a 2 s timeout, and Cache API caching for about 24 h per normalised query. The client debounces 250 ms, requires at least 4 characters with a digit or a street word, and cancels any in-flight request. Bias results with the rounded **map centre** (about 1 km), but **send no `lat`/`lng` at all while the view is still centred on a located position** (from Locate until the user pans more than about 2 km or searches somewhere else). In that state the request is unbiased, so the position never leaves the browser, even in rounded form.
  - **Fallback:** if the geocoder is offline or times out, groups 1-2 still show, and the Addresses group shows "Address search is offline right now" (see the states board).
  - Choosing an area or address flies the map there (`fitBounds` with the bbox, or `flyTo`) and drops a temporary search pin, which a dismiss "x" removes. Attribution for the gazetteer/OSM data lives in the map credit ("© OpenStreetMap contributors · GeoNames").
- **Feed sync:** on `moveend` (debounced about 120 ms), `queryRenderedFeatures` or a bbox filter over the in-memory places array, sorted by distance from the map centre. The list is virtualised (only visible rows in the DOM).
- **Measure:** Lighthouse mobile (LCP, TBT), a 10 s pan trace with the Michelin layer on at z6, z10 and z13 in the Performance panel, and JS transfer size. These are the acceptance numbers in §7.

## 5b. Home backend API contract (`https://api.travel.zachle.info`, behind the Cloudflare Tunnel)
**Who calls what, and how it authenticates:**
- **Public, no secret:** `GET /v1/tiles/*` and `GET /v1/health`. These are exempt from the proxy secret. The browser calls them directly on `api.travel.zachle.info`, so each tile does not cost a Worker request, and the CDN caches them. They are read-only, cacheable and rate-limited at the backend.
- **Worker-only (proxy secret):** `/v1/geocode` and `/v1/live`. The browser calls `/api/geocode` and `/api/live` on the site origin. The Worker forwards them with `X-Travel-Proxy: <PROXY_SECRET>` (a Worker secret), and the backend rejects these two routes without it.
- **Admin (Bearer token):** `/v1/admin/*` requires `Authorization: Bearer <ADMIN_TOKEN>` and is never proxied by the Worker. The Discord bot reaches it inside the Docker network at `http://api:8787` with the same Bearer token; the internal network grants no extra trust. The planner routine reaches it over the tunnel with the Bearer token. All responses are JSON unless noted, served with CORS for the site origin only and `ETag`s.

| Method and path (backend) | Site path (via Worker) | Purpose | Cache |
|---|---|---|---|
| `GET /v1/health` | `/api/health` | `{ok:true, version, live_updated_at}`, used for the offline check | no-store |
| `GET /v1/tiles/{tileset}/{z}/{x}/{y}.mvt` | browser fetches `https://api.travel.zachle.info/v1/tiles/…` directly (CORS for the site origin), not via the Worker | Protomaps basemap tiles above z10 from the PMTiles server (`tileset` = `basemap-v<date>`) | `public, max-age=2592000, immutable`, CDN-cached at the tunnel's edge |
| `GET /v1/geocode?q=&lat=&lng=&limit=8` | `/api/geocode?q=…` | Street addresses from self-hosted Photon; `lat`/`lng` = map centre rounded to 2 decimals, omitted while the view is centred on a located position (§5) | Worker Cache API 24 h per normalised query |
| `GET /v1/live?since=<iso>` | `/api/live` | Owner-added places and events: `{places:[{id,name,lat,lng,category,note,added,source:"discord"}], events:[{id,title,venue,city,start,end,url,added}], updated_at}` | `public, max-age=60, stale-while-revalidate=600` |
| `POST /v1/admin/places` · `PATCH /v1/admin/places/{id}` · `DELETE /v1/admin/places/{id}` | not exposed to browsers | Admin writes (the Discord bot and planner routine call the backend directly over the tunnel) | n/a |
| `POST /v1/admin/events` · `PATCH` · `DELETE` | not exposed to browsers | as above | n/a |

- **Admin auth:** `Authorization: Bearer <ADMIN_TOKEN>`, a long random token held only by the home backend and the bot/routine, rotated by changing an env var. It is never in the site, the Worker or the repo. Admin routes listen only on the tunnel hostname (or are additionally IP-restricted to the tunnel connector). Rate-limit writes and validate every field server-side (category must be one of the 24, coordinates in range, text length caps). The privacy filter (no tickets, bookings, names, attendance, trip dates; `private` flag) runs before insert, and the backend refuses a payload that fails it.
- **Discord interactions** (later): `POST /v1/discord/interactions`, with Ed25519 signature verification per Discord. It lives on the home backend, reached by Discord through the tunnel.
- **Storage:** SQLite (WAL) on the home box with nightly backups. The schema is versioned with migrations in the backend repo.
- **Failure contract:** any 5xx or timeout over 2 s counts as offline for that feature only; the site falls back as described in §5.

## 5c. Home backend deployment: one Dockge stack
Files: `backend/compose.yaml` and `backend/.env.example` in this folder (validated with `docker compose config`). It is a single Dockge stack named `travel-backend` with four services:

| Service | Image (pinned) | Role | Exposed |
|---|---|---|---|
| `api` | `travel-api:0.1.0` (built from the backend repo) | the `/v1/*` API from §5b; SQLite (WAL) at `/data/live.sqlite`; proxies `/v1/tiles/*` to `tiles` (adding long `Cache-Control`) and `/v1/geocode` to `photon` | through the tunnel only, as `api.travel.zachle.info` |
| `tiles` | `protomaps/go-pmtiles:v1.31.2` | serves `basemap-v<date>.pmtiles` from its volume | internal |
| `photon` | `rtuszik/photon-docker:2.5.0` | street geocoding (prebuilt index, `REGION=us`) | internal |
| `cloudflared` | `cloudflare/cloudflared:2026.11.2` | remote-managed tunnel, with the public hostname `api.travel.zachle.info` → `http://api:8787` | outbound only |

- Named volumes: `api_data`, `tiles_data`, `photon_data`. Restart policy `unless-stopped` on every service. Healthchecks on `api` and `photon`; `tiles` and `cloudflared` are distroless, so `api`'s `/v1/health` reports the reachability of tiles and photon. `cloudflared` starts after `api` is healthy.
- Secrets come only from `.env` (`ADMIN_TOKEN`, `PROXY_SECRET`, `TUNNEL_TOKEN`, later `DISCORD_*`). The Worker holds `PROXY_SECRET` as a Worker secret. Nothing secret goes in compose, the repo or the site.
- The Discord bot is a later fifth service (commented stub in the compose), talking to `api` on the internal network with `ADMIN_TOKEN`.
- Ops notes: back up `api_data` nightly (SQLite `.backup`). Refresh `basemap-v<date>.pmtiles` by dropping a new file into `tiles_data` and bumping the tileset name the site requests, which also busts the CDN cache. Photon's first index download is large (US: tens of GB), so check disk space before starting.

## 6. Interactions and motion
Under `prefers-reduced-motion`, every one of these becomes an instant state change.

| Trigger | Motion | Time / easing |
|---|---|---|
| Heart tap | scale .8 → 1.2 → 1, 3 small dots drift out and fade, fill turns rose | 360 ms `--ease-pop`; dots 500 ms ease-out |
| Un-heart | shrink to .8 and back; the picks row slides out | 260 ms ease-out |
| Picks counter | digits roll, pill bumps to 1.18 | 300 / 420 ms |
| Sheet snap (peek / half / full) | 1:1 drag, rubber band at the ends, velocity-projected snap, no overshoot | 440 ms `--ease` |
| Map fly-to (search pick, peek, area) | `easeTo` the target, zoom 15 (areas: fit bbox, 12-15), padding for the sheet | 600-700 ms |
| Pin appear | dots fade out z13.4-13.9 while icons fade in z13.5-14.0; Michelin pins z9.5-10.3 (map-driven) | zoom-driven, no bounce |
| Locate | pulse ring 8 → 24 px, 1.6 s loop; button spinner .9 s | static ring under reduced motion |
| Dense hint / offline pill / search-pin chip | fade + 6 px rise | 250-300 ms |

The prototype's hash presets (`#s=filters`, `#loc=denied`, `#offline=1`, `#michelin=1`, and so on; see `notes.md`) show every state. Use them for the visual acceptance pass.

## 7. Acceptance checks
- Every place in the data is reachable both as a pin and in the list. No clustering at any zoom.
- Filters: all 28 lists, every category, My lists / Other lists / Michelin, region, Hide been, the Michelin chips and any-year vs current. Active count and one-tap Clear.
- Search flies the map and opens the peek. Locate me degrades gracefully when permission is denied.
- Pins are legible on standard light and standard dark. The Key is always reachable.
- Hearts: `aria-pressed` with a label naming the place; picks persist in `localStorage`; the share link encodes ids and opening it highlights those picks; Copy as text works.
- Tap targets: the prototype enlarges hit areas with a centred `::after`. In production make the interactive element's own box at least 44x44 (for example `min-height: 44px` with the visual chip drawn inside), because the kotone smoke test measures element boxes at 390 px.
- AA contrast in both themes (body ≥4.5:1, filled buttons rose-600+ under white text). Pin glyphs reach 3:1 or better. Focus visible, 44 px targets, reduced motion respected.
- Performance budgets from §5 are met, with the numbers recorded in the PR.
- Attribution is visible for OpenStreetMap/Protomaps, GeoNames and 19hz.info. The browser makes runtime requests only to the site origin (and `api.travel.zachle.info` if tiles are fetched directly); 19hz.info is fetched only by the Worker, cached (check the Network panel).
- Offline drill: with the backend stopped, the site loads, the map shows the low-zoom basemap, saved places, Michelin and place/area search work, and the offline pill and the address note appear. Restarting the backend clears them within 60 s.
- No private data: no trip dates, tickets, bookings, allergies or food flags (a guard in the export blocks the build).

## 8. Owner decisions still open
1. **Sign-off on round 3** (this composition and spec). Nothing is built until he approves.
2. **Default view on open:** where the map starts (an SF centre at z13, his last view remembered in `localStorage`, or Locate on first visit, which needs a tap) and the zoom at which icons appear (now about z13).
3. **Quick filters:** the two-row phone layout (sources, Michelin and Hide been; then categories). Which categories deserve a quick chip, versus living only in Filters?
4. **Michelin award colours:** Star amber, Bib teal-blue, Green Star green, Selected stone. Amber and teal sit outside his palette on purpose, so awards read apart from categories. Confirm, or bring them in-family.
5. **Owner-added items** (Discord): should new items float to the top of the feed for a while (as in the demo), or sort normally with only the "New" badge?
6. **Basemap coverage:** which regions get detailed tiles (z15) on the home server, and whether to ship a world low-zoom basemap so Michelin dots abroad have context. This is a size versus coverage trade.
7. **Photon index scope and disk:** a US-wide index needs tens of GB on the home box; the alternative is the covered states only (jsonl import).
8. **19hz.info:** the Worker fetches it server-side, the one remaining outside source, which is the data itself. Confirm that is acceptable under "no third-party services".
9. **Real data still to land:** `michelin-world.csv` (the sample tags and points in the prototype are placeholders) and the owner-added content store (home backend SQLite, which needs the backend stood up).
10. **Brand assets:** the wordmark is plain Figtree text, and there is no app icon or favicon set yet (the starter's `build-icons.mjs` regenerates them once he picks).

