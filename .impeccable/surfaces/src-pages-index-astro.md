---
version: 1
slug: "src-pages-index-astro"
primary_target: "src/pages/index.astro"
related_targets: []
---

# Surface brief: Little Travel Book, explorer (home route)

Scope: the home route, the whole explorer (map, sheet/feed, filters, search, peek, picks, shows). Mode: Operate. The primary user is the owner, exploring his saved places, the other lists and shows daily on phone and desktop. A date or friends are secondary visitors who heart places and send picks.

Approved composition: `docs/design/round-3/` (phone.html, desktop.html, states.html). Build spec: `docs/design/round-3/HANDOFF.md`. Build assets: `docs/design/round-3/build/`.

Unresolved: see HANDOFF.md §8 (owner sign-off, default view, award colours, basemap coverage, Photon scope, brand assets).

## Direction contract
THESIS: A calm, map-first explorer, with the cuteness carried by icons and small motion. It refuses the directory-with-a-map template: no clustering, no category folders, no grouped sections. Every saved place is its own readable pin, and the feed is the map's own list.

OWN-WORLD: Deep plum ground (dark by default) or lavender-white, in his mauve, rose and lavender families. One rounded friendly sans. Chubby rounded-stroke category icons in tinted discs, one per category, coloured by group (single source: build/tokens.css): food rose, drinks violet, shopping mauve, sights slate-lavender, outdoors muted green, activities plum, logistics grey-lavender. Soft rounded sheets and chips. Rose is reserved for hearts and the primary action.

STORY: He opens it and sees his places around him at once. He narrows with chips or search, the map jumps, and he peeks, checks details and opens Maps. A visitor understands it in a minute, hearts a few places and sends picks back.

FIRST VIEWPORT: Phone (dark by default): a full-bleed map; at the top, a search bar with a Filters count, a chip row for My lists / Other lists / Michelin / Hide been, and a scrolling row of category chips with icons; at the right, map controls (Key, Locate). An Apple-Maps sheet at peek height holds the Map|List toggle, "N places in this area", Sort (Nearest) and the first rows. The tab bar has Places, Shows and Picks (with count). Desktop: a full-bleed map with a floating left panel (search, chips, synced feed), plus Shows, Picks and theme at the top right.

FORM: The standing exit (category-standard map explorer) executed at full craft, chosen by the owner over the four round-1 worlds; round-2 variation A of three (map first, subtle). seed:1ea4a0acda1d7fe9

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
