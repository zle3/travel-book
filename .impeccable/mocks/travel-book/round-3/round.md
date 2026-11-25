# Round 3 (converge and refine): A, map first

Task design-r1 · director kotone-design-director · 2026-11-24
Status: DONE pending owner sign-off. Refined design built, kotone-reviewer critique applied (all blockers and majors fixed). Open decisions: HANDOFF.md §8.

## Inputs from the owner during the round
- He is the primary daily user; visitors are secondary (heart + send picks).
- Satellite toggle requested, then dropped. Dark is the default.
- Michelin: sample badges, then a US layer, then a worldwide layer (15-20k) that must not lag (PMTiles, GPU layers, off by default).
- Locate me (privacy: the position never leaves the browser) and area/address search.
- No third-party runtime services; no Cloudflare D1/KV/R2. A home backend (Dockge stack: api+SQLite, go-pmtiles, Photon, cloudflared) with static offline fallbacks.

## Outputs (docs/design/round-3/)
- phone.html, desktop.html, states.html, phone-states.png (20 frames), captures, icons.html/png
- build/: tokens.css, icons.svg, categories.json, map-config.js
- HANDOFF.md (regions, tokens, data, performance architecture, home API contract, Dockge stack, motion, acceptance checks, open owner decisions)
- backend/compose.yaml, backend/env.example (validated with docker compose config)
- Direction contract: .impeccable/surfaces/src-pages-index-astro.md (seed:1ea4a0acda1d7fe9)

## Review (kotone-reviewer)
- Blockers: HANDOFF placeholders (filled); categories.json vs tokens drift (fixed: tokens.css single source); pmtiles load timing contradiction (fixed); tiles/proxy-secret contradiction (fixed: tiles and health are public, geocode and live are Worker-only, admin is Bearer).
- Majors: geocode bias leaked the located position (fixed: no bias while centred on the located position); offline basemap tiers (fixed: duplicated layers, static overzoom underneath); tap targets under 44 (fixed with hit areas; production must size the element box); quick row overloaded (fixed: two rows on phone); search index budget (fixed: metro-scoped, hash shards).
- Minors handled: JS budget scope, compose (no blocking depends_on, healthcheck notes), light label contrast, type scale, sheet scroll at half and interrupt handling, wording, icon threshold to z13.
- Stale phone-satellite.png and desktop-satellite.png: the designer's delete was refused by the permission system, so they are left untracked (not committed); the lead or owner can remove them.

## Owner's choice
(pending sign-off; open decisions in HANDOFF.md §8)
