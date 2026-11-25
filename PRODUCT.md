# Product

Owner brief taken 2026-11-24 (Zach Le). Owner sign-off pending.

## Platform and users
- Public static site at travel.zachle.info (Astro on Cloudflare Workers). **No password gate** (owner decision 2026-11-24); keep `noindex` unless the owner says otherwise.
- **Primary user: the owner (Zach)**, exploring his own saved places, other lists and shows on his phone and desktop (owner decision 2026-11-24). Secondary: a date or friends he sends the link to, who heart picks and send them back.
- Mobile first. Many visits come from a link sent in a text message.

## Product purpose and positioning
- A cute, artistic "little travel book": places and shows around the Bay Area, Sacramento and Seattle (and NYC from a friend's list) that the owner has saved or wants to try.
- Main jobs: **explore the map freely, find something to do nearby or on a date, and check details fast.** Secondary: hearts/picks that a visitor can send back (share link or copied text). No accounts, no backend storage of picks.
- It is a personal, hand-made scrapbook, not a directory or a business site. It should feel like a gift, not a corporate product.

## Content and data (the only facts the site may show)
- `places` databases (owner's curated lists, exported from the private planner repo by `tools/publish_site.py`): name, area, short note, link, flags (drink minimum, bar-centric). Some entries are marked "been" by the owner.
- **Google Maps saved lists** (exported by `tools/import_gmaps.py`): 28 lists, ~2,080 places with name, address, lat/lng, owner note, Google Maps link.
  - Owner's lists, grouped: Food (Breakfast/Brunch, Casual Food, Sit Down Restaurants, Fine Dining, Bakery, Desserts), Drinks and Nightlife (Tea/Drinks, Bar/Club), Shopping (Shopping, Clothing, Grocery), Sightseeing and Culture (Points of Interest, Tourist Attractions, Museums, Venues, Roadside Destinations), Outdoors (Parks, Hiking, Trails), Activities and Recreation (Activities, Sports, Guns), Travel Logistics (Hotels, Parking Lots).
  - Other people's lists (SF, Sac, Bay Area, NYC): shown as **"Other lists"** (not all are friends; never call them friends' picks), filterable on/off separately from the owner's own lists. Each of their places is **categorized into the same categories as the owner's lists** (Casual Food, Tea/Drinks, Museums, Parks, etc.), so category filters work across both sources.
  - Every list must be filterable, including Hotels and Parking Lots.
- Live "shows coming up": DJ sets, concerts and dance nights from 19hz.info, fetched through the site's worker and cached about 1 hour. Credit 19hz.info.
- Not every saved place has been visited. Do not imply the owner has been somewhere unless the data says "been".

## Capabilities (must have)
1. **Map** of places (owner's lists + other lists), with **no marker clustering** (every place its own pin; easy free exploring), filters by list, group and region, and a list view in sync with the map. Open-data map tiles (no paid API key).
1a. **Map style:** standard map in light and dark styles only. **No satellite** (owner decision 2026-11-24: dropped, since it cannot be self-hosted).
1b. **Michelin filter:** places tagged with Michelin distinctions from the last 5 editions (2022-2026: Stars, Bib Gourmand, Green Star, Selected), with the year shown on the place card. Filter chips such as "Michelin ⭐" and "Bib Gourmand", plus a "recognized any year" option. Covers the **whole world** (~15-20k restaurants): saved places get badges, and all Michelin restaurants (2022-2026) are a browsable map layer, **off by default**, loaded as vector tiles only for the visible area (never one big download). Data in `places/michelin.json` (owner's private repo), exported with the site data.
1c. **Location:**
   - "Locate me" button using the browser's geolocation: centers the map on your exact position with a pulsing dot, and the feed re-sorts by distance. It asks permission only on tap. The position stays in the browser: never sent to the server, never stored, never logged.
   - Search by area or address (city, neighborhood, zip, street address) that flies the map there. One search box: saved places and Michelin names first, then places and addresses. **No third-party search services** (owner decision 2026-11-24): a self-hosted, build-time search index (saved places, Michelin, plus an open-data gazetteer of cities, neighborhoods and ZIP centroids) ships with the site and runs in the browser. **No street-address search** (owner decision 2026-11-24): search goes down to city/neighborhood/ZIP only, fully in-browser. No Photon.
2. **Browse and search** with filters (region, category/list, source: mine vs other lists, hide "been").
3. **Hearts / picks**: saved in the visitor's browser; a picks sheet with "send me your picks" (share link that encodes the picks) and "copy as text". Opening a shared picks link shows those picks highlighted.
4. **Shows coming up** by region and date range, searchable.

5. **Owner adds content from Discord** (owner only, never the visitor): events and/or locations posted by the owner appear on the site without a code deploy.
   - **One Discord channel (`#planner`) for everything** (owner decision 2026-11-24). Posts are **public by default**; anything with tickets, confirmations, bookings, people's names, the owner's own attendance or trip dates, or marked `private`, stays private. The planner routine parses posts and writes them to the site's live data store through a secret, owner-only admin endpoint on the Worker.
   - Slash commands for instant structured adds (e.g. `/place`, `/event`) handled by the same Worker (Discord interactions endpoint, signature-verified).
   - Live data (SQLite on the owner's home backend) merges with the built-in exported data at read time. Owner-added events show alongside 19hz shows; owner-added places appear in lists/map with their category.
   - Approved 2026-11-24: home-backend live data store plus an admin secret in the cloud environment (runtime data, not code; code still ships only through the merge queue).

## Brand commitments
- Owner palette from zachle.info (`zli-ppr-custom` scheme): primary mauve (`rgb(155,107,132)` scale), secondary rose (`rgb(244,63,94)` scale), neutral lavender-grey (`rgb(116,116,155)` scale). zachle.info defaults to dark appearance; support both light and dark.
- Tone: **clean, minimal and easy to use**, with cute accents only: small custom icons, playful micro-animations (heart pop, picks wiggle, pin drops), the mauve/rose/lavender palette, rounded shapes, friendly copy. No heavy concept styling (owner feedback after round 1, 2026-11-24).
- Pins must be easy to identify: each pin carries its category icon (color = category group), there is an always-reachable legend, and filter chips use the same icons.
- Browse is one continuous explorable feed, not grouped sections; moving the map updates the list.
- Never publish the owner's private plans: no trip dates, tickets, hotel bookings, calendar, profile, allergies or schedule. Lists named "Hotels" and "Parking Lots" are just saved places, not bookings.

## Evidence on hand
Only the exported data above. No testimonials, ratings, prices or claims beyond what the data notes say.

## Performance requirements
- WebGL map (MapLibre GL); all pins as GPU layers with an icon sprite; no clustering.
- Michelin world layer as zoom-bucketed static tile files (each under the Workers 25 MiB asset limit) fetched per viewport only when the layer is on; tiny dots at low zoom, icons from ~zoom 9-10, details on tap.
- **No Cloudflare storage products (D1, KV, R2)** for this project (owner decision 2026-11-24: avoid free-tier limits shared with his other projects). Cloudflare Workers serves only the static site plus a thin proxy.
- **Owner's home backend** (Docker managed with **Dockge**: delivered as one Dockge stack, `compose.yaml` + `.env.example`, with a `cloudflared` tunnel sidecar; Docker on his home server, exposed through his Cloudflare tunnel, e.g. api.travel.zachle.info) holds everything dynamic:
  - live data store (SQLite) for owner-added places/events, with an owner-only admin API (secret token);
  - self-hosted basemap tiles (Protomaps PMTiles regional extract served by a tile server), with long Cache-Control so Cloudflare's CDN caches them;
  - later: the always-on Discord planner bot.
- If the home backend is offline the site must still work: static saved places, Michelin tiles and gazetteer search ship with the site; a small low-zoom basemap ships as a static asset so the map never goes blank; live adds and street-address search show a gentle "offline" note.
- Budgets: <300 KB JS gzipped on first load, LCP <2.5 s on a mid-range phone, smooth 60 fps panning with all layers on.

## Product principles
- Delight first, but fast: map and list must stay smooth on a mid-range phone with about 2,000 places.
- Map first (owner picked round-2 direction A, 2026-11-24). Fast to use daily for the owner; a first-time visitor still understands it within a minute.
- Privacy: picks stay in her browser until she chooses to send them.

## Accessibility and inclusion
- WCAG AA contrast in both themes, reduced-motion support, keyboard and screen-reader usable hearts and filters, and a list alternative for the map (every map place also reachable in the list).

## Weather (added 2026-11-24)
- Open-data weather for wherever the map is centered (and for each event's date/place on show cards): current conditions, hourly for today, 7-day daily, sunrise/sunset.
- Sources: **Open-Meteo** (open-source, free, worldwide; self-hostable later on the home backend) as primary; **NWS api.weather.gov** for US forecasts and active alerts. Both fetched through the Worker with caching (about 15-30 min), coarse rounded coordinates only (2 decimals), never the visitor's exact location.
- Optional rain radar overlay from an open source (e.g. RainViewer or NOAA/NWS radar tiles) as a toggle, off by default.
- Small, cute weather chip on the map (icon + temp); tap for the detail sheet. Data sources are allowed per decision 8.

## Owner decisions, round 3 sign-off (2026-11-24)
1. Round 3 (direction A refined) approved for build.
2. Map opens at the last view (stored in the browser); first visit opens on San Francisco.
3. Phone quick chips: Food, Boba/Tea, Desserts, Sights, Shows. Everything else under Filters.
4. Michelin colors: keep amber (stars) and teal (Bib Gourmand).
5. Discord-added items: "New" badge for 7 days, no pinning.
6. Basemap: his regions in detail plus a small low-zoom world overview.
7. No address search; city/neighborhood/ZIP gazetteer only. No Photon service.
8. External **data sources for events** (19hz.info etc.) are fine; the "no third-party services" rule covers infrastructure (search, tiles, storage), not event data.
9. Wordmark: plain text.
