# Routes, API contract and data pipeline (v1)

Source of truth for what the site and its Worker serve. Product rules: `PRODUCT.md`. Design spec the build follows: round 3 `HANDOFF.md` on the design branch, with the owner decisions of 2026-11-24 applied (they override it).

## Pages
| Route | What |
|---|---|
| `/` | The explorer: map, sheet or panel with the feed, filters, search, peek card, picks, shows, weather. One page, no other routes. |
| `/404` | Plain not-found page with a link back to the map. |

Client state lives in the browser only: `localStorage` keys `tb-theme`, `tb-filters`, `tb-picks`, `tb-view` (last map view; first visit opens on San Francisco), `tb-sort`, `tb-dense`. A share link is `/#picks=<id>,<id>` (ids are short base-36 place ids; the fragment never reaches the server).

## Worker routes (same origin, `worker/api.ts`)
All GET or HEAD, JSON, no Cloudflare storage products (Cache API only). Every response carries `X-Robots-Tag: noindex`.

| Path | Purpose | Cache |
|---|---|---|
| `/api/events?region=bayarea\|seattle\|losangeles` | Shows from 19hz.info: the Worker fetches `https://19hz.info/eventlisting_<BayArea\|Seattle\|LosAngeles>.php` and parses the table (`worker/nineteenhz.ts`). `{region, source, fetched, events:[{id,title,venue,city,url,when,date,tags,price,age,orgs,origin}]}`. A failing upstream serves the stale copy, else 502. | 1 hour |
| `/api/weather?lat=&lng=&units=f\|c` | Open-Meteo forecast for the **map centre**, coordinates rounded to 2 decimals before any upstream call and in the cache key. Adapted to `{source, weather:{units,tz,now,hours,days,fetched}}` (`src/lib/weather.ts`). Never the visitor's exact position. | 20 min |
| `/api/alerts?lat=&lng=` | NWS `api.weather.gov` active alerts for US points (rounded to 2 decimals); non-US answers `{alerts:[]}` without a request. Generic User-Agent, no contact details. | 15 min |
| `/api/health` | Backend reachability for the offline pill (`BACKEND_BASE/v1/health`, 2 s timeout). 503 `{ok:false}` when unset or down. | no-store |
| `/api/live` | Owner-added places and events (Discord) from `BACKEND_BASE/v1/live`, sent with `X-Travel-Proxy: <PROXY_SECRET>`. 503 when unset or down; the client treats that as "offline" and keeps working. | 60 s |

Static asset cache headers are set in the Worker (`assetCacheControl`): hashed `data/places.*` and `search/areas.*` and `_astro/*` immutable for a year; `michelin/`, `search/`, `glyphs/`, `fonts/`, `basemap/`, `style/` and `icons.svg` one day with stale-while-revalidate.

The gate is off (`GATE_DISABLED=1` in `wrangler.jsonc`, owner decision 2026-11-24). Bot blocking, `robots.txt` and `noindex` stay on.

## Home backend contract (`https://api.travel.zachle.info`, behind the Cloudflare Tunnel)
Photon and any geocoder are **removed** (owner decision 2026-11-24): there is no address search and no `/v1/geocode`.

| Path (backend) | Auth | Purpose |
|---|---|---|
| `GET /v1/health` | `X-Travel-Proxy` (via the Worker) | `{ok:true, version, live_updated_at}` |
| `GET /v1/tiles/{tileset}/{z}/{x}/{y}.mvt` | public, CORS for the site origin | Protomaps basemap tiles. The browser calls this directly (no Worker request per tile). `Cache-Control: public, max-age=2592000, immutable`. The site requests tileset `PUBLIC_TILESET` (default `basemap-v20261124`) from `PUBLIC_API_BASE`. |
| `GET /v1/live?since=<iso>` | `X-Travel-Proxy` | `{places:[{id,name,lat,lng,category,note,added,source:"discord"}], events:[{id,title,venue,city,start,end,url,added}], updated_at}` |
| `POST/PATCH/DELETE /v1/admin/places\|events` | `Authorization: Bearer <ADMIN_TOKEN>` | Writes from the Discord bot and planner routine. Never proxied by the Worker. |

`backend/compose.yaml` and `backend/env.example` are the Dockge stack (`api`, `tiles`, `cloudflared`). The `api` image is built from a backend repo that does not exist yet. Until it does, `/api/live` and `/api/health` answer 503, the offline pill ("Some live bits are offline. Saved places still work.") shows after a short settle delay, and everything else keeps working.

## Basemap
- **Home (primary):** Protomaps vector tiles from the home tile server, styled by `public/style/home-{light,dark}.json` (layers generated from `@protomaps/basemaps` with the design FLAVOR colours, ids `h-*`). Requested only from zoom 6.
- **Static overview (always shipped):** `public/basemap/land.json` and `cities.json` (Natural Earth 110m, public domain) drawn under the home layers, so the map shows land, water and big-city labels with no network. Glyphs and fonts are self-hosted (`public/glyphs`, `public/fonts`).
- Three or more home tile failures in 30 s (404 or 204 "outside the extract" do not count) or a failed health check hide the home layers and show the pill; the 60 s health check brings them back.
- Rebuild: `npm run data:basemap`.

## Data pipeline (`scripts/data/`, output committed, a unit test fails when it is stale)
| Script | Inputs | Output |
|---|---|---|
| `build-data.mjs` (`npm run data:build`, `data:check`) | `src/data/gmaps.json`, `michelin-matches.json`, `gazetteer.json`, `data/michelin-world.csv` | `public/data/places.<hash>.json` (2,013 merged places, about 117 KB gzipped), `public/search/areas.<hash>.json`, Michelin files (below), `src/generated/manifest.json` |
| `build-gazetteer.mjs` | GeoNames `US.zip` and the Census 2023 ZCTA gazetteer (downloaded once) | `src/data/gazetteer.json` (4,440 cities, neighbourhoods and ZIP centroids for the four metros) |
| `build-basemap.mjs` | `@protomaps/basemaps`, Natural Earth, Protomaps font glyphs | `public/style`, `public/basemap`, `public/glyphs` |

Saved places: the Google lists merge into one record per place (accent-insensitive name within 60 m unions the lists; the owner's lists win category and note). Empty addresses are fine (the row simply omits the city). `src/data/places.json` (the owner's curated markdown lists) has no coordinates and is not on the map in v1.

Michelin (24,364 restaurants), zoom-bucketed static files, none near the 25 MiB limit (largest tile is under 100 KB):
- `michelin/low.json`: every point as `[lng, lat, best, latestYear]` for zoom below 5.5.
- `michelin/t/<x>-<y>.json`: a z5 grid of tiles (62 files) with `[id, lng, lat, best, latestYear, name]` for the viewport above zoom 5.5.
- `michelin/d/<xx>.json`: 256 detail shards (awards by year, city, country, guide URL), loaded on tap.
- `search/mn-<NN>.json`: 64 name-search shards. A name sits in the shard of each word's first three characters, so a query loads one small file and non-Latin names work.
The layer is off by default and nothing from it is fetched until it is switched on.

Search is entirely in the browser: saved places (from the loaded data), Michelin names (one shard per query), and the gazetteer (loaded on first focus of the box). No address search, no third-party service.

## PR plan
The work is delivered as **one PR** (`task/build-v1`): the data, the map shell, feed, filters, search, picks, shows, weather and the backend stack depend on each other, and the framework allows one PR per task branched from `main`. Logical slices, in review order: (a) data pipeline and tiles, (b) map shell and feed, (c) filters, search, picks, (d) shows, weather and the Worker API, (e) backend stack and docs.

## Budgets (measured, see the PR)
First-load JS (app chunk plus MapLibre plus the small lazy modules): about 234 KB gzipped (191 KB brotli); lazy Michelin, search and detail files are excluded. LCP is the server-rendered shell. Numbers and method are in the PR description.

## Owner must provide
- Backend: `ADMIN_TOKEN`, `PROXY_SECRET` (also `wrangler secret put PROXY_SECRET`), `TUNNEL_TOKEN`, the `travel-api` image or repo, and the DNS name `api.travel.zachle.info` on the tunnel.
- Basemap: the regional Protomaps extract (`pmtiles extract https://build.protomaps.com/<date>.pmtiles basemap-v<date>.pmtiles --bbox=...`) dropped into the `tiles_data` volume, and which regions get detail. If the tileset name changes, set `PUBLIC_TILESET` at build time.
- A refreshed `gmaps.json` with addresses (then `npm run data:build`).
