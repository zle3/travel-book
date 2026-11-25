# Round 1 (diverge): Little Travel Book, whole-site world

Task design-r1 · director kotone-design-director · 2026-11-24
Status: 4 prototypes done and reviewed; decision page served (key acd43254, http://127.0.0.1:42659/); static board docs/design/round-1/index.html; waiting on owner.

## Frame
- Surface: the whole site's visual world (new world; DESIGN.md is the neutral starter). Mode: Experience for the world and landing (the gift leads); the map, list and filter screens follow Operate discipline inside that world.
- Product mechanism: he hands her a little book of every place he has saved; she hearts what sounds fun and sends the picks back.
- Scene: his date on her phone, opened from a text link, casual evening browse. Cultural home: Bay Area / Sac / Seattle boba, matcha, egg tarts, anime shops, night markets, raves on 19hz.
- Rut kept out: the saved-places map app (Google/Apple Maps clone, which is the canon card) and its predictable opposite, the cream scrapbook with washi tape and serif (the literal reading of "travel book").
- Build path: code-led (no image generation on this machine). Cards carry HTML first viewports.

## Grounded candidates (ordered by resonance, fixed before the roll)
1. Purikura sticker-booth sheet (photo/sticker)
2. Airmail letter and postage stamps (post)
3. Risograph two-ink zine (print)
4. K-pop photocard collect binder (collectible)
5. Night-market lantern signage (light/signage)
6. Cross-stitch sampler on dyed linen (textile)
7. Scrapbook / planner journal with washi (paper; the literal reading, spent here)

## Roll
- concept-seed --scope direction --mode experience, SEED REFERENCE seed:1ea4a0acda1d7fe9. Assigned index 6: the Sampler.
- Challengers (all declined, each donated one discipline to the Sampler as a named raise): seven-segment clock (ghost states), ink basin (material-law motion), cassette deck (every list its own labeled control), op-art textile (one continuous cloth), forge (one stroke visibly changes the object), quote grammar (literal zone labels).
- Hand: assigned A + pick B (my top grounded) + grounded C and D. The roll's honest hand was two full cards; the owner's brief asked for 3-4 directions, so two more of my grounded directions join as `grounded` cards.

## Options (docs/design/round-1/<slug>/)
- A `a-sampler` The Sampler (assigned)
- B `b-photobooth` Photo Booth Sticker Sheet (pick)
- C `c-airmail` Par Avion (grounded)
- D `d-riso` Two-Ink Zine (grounded)
- Canon: clean map app (standing exit, never recommended)

## Director review (before the owner saw it)
- A: first build too dense (spool racks on the landing), title all caps. Revised: racks moved to the map/filter screen, mixed-case stitched title, 52px hearts, 5 rows visible.
- B: bakery wore the noodle-bowl doodle. Revised: per-list doodles for bakery, desserts and sit-down.
- C: postmark ring text clipped, envelope mini-stamps covered content, every food stamp used the same bowl. All fixed.
- D: shared Bagel Fat One with B, which hurt distinctness at display level. Swapped to Shrikhand.
- Old Sacramento Waterfront (curated, been) was given approximate coordinates in A and B to demo "hide been". It is labeled "Sacramento picks" and disclosed in notes.md.
- Detector advisories common to all: white text on rose-500 is 3.7:1 (filled buttons need rose-600/700 under white text); decorative grid/stripe backgrounds (B, C) are flagged as generated-UI tells and should become authored textures in round 2. Ghost hearts in dark mode (A) need 3:1 against the cloth for the control boundary.

## Owner's choice
(pending)

## Carries forward to round 2 whatever wins
- Real data only; sample.json is the scrubbed source. Fonts self-hosted in the build.
- Accessible filled-button colour (rose-600+ under white text), AA in both themes.
- Map stack: MapLibre GL + OpenFreeMap vector tiles (no key), restyled per world; clustered GeoJSON.
