# Round 2 shared brief: Little Travel Book (task design-r1)

You are building ONE variation of round 2. The director owns the round. Read this file, then your variation brief.

## What the owner said after round 1
"It doesn't need to be this stylized. It should be clean and minimal and easy to use, but with cute keynotes such as icons, animations, colors, etc."

So the base is a **clean, minimal, highly usable app UI**: clear hierarchy, generous whitespace, simple cards and lists, an obvious map/list toggle, filters that are easy with one thumb, fast scanning. Cuteness comes ONLY from accents: small custom icons (one per list group), playful micro-animations (heart pop, picks-counter wiggle, soft marker drops), the mauve/rose/lavender palette used warmly, rounded shapes, friendly empty states and copy. Stamp/sticker/seal/stitch motifs survive at most as a tiny touch (inside the heart animation or the picks sheet), never as page chrome, textures or backgrounds. No paper, grain, stripes, grids or patterned grounds.

Bar to hit: the polish of a top-tier consumer iOS app (think Apple Maps' sheet, Airbnb's wishlists, a calm modern list app), with a little warmth on top. Load the apple-design skill for sheets, springs, touch feedback and typography, and impeccable's craft floor.

## Where things are
- Task worktree: `/mnt/wsl/work/worktrees/travel-book-design-r1`. Write ONLY inside `docs/design/round-2/<your-slug>/`. No commits, nothing else touched.
- Product truth: `/home/sakiaya/projects/travel-book/PRODUCT.md` (main checkout). Design rules: worktree `DESIGN.md`.
- Real data (scrubbed), CURRENT: `/mnt/wsl/work/worktrees/travel-book-design-r1/docs/design/round-2/_data/sample.json` in the public export shape `{lists:[{name, source:"mine"|"other", group, count, places:[{name,address,lat,lng,note,maps,category,group}]}], shows_snapshot, curated}`. Other lists are "SF list", "Sac list", "Bay Area list", "NYC list"; every place (both sources) has its real `category` and `group`; Other-list notes are blank. Includes every place in the SF window (492) plus up to 40 per list elsewhere. Round-1 sample.json is superseded.
- Round 1 for reference only (what NOT to do: heavy worlds): `docs/design/round-1/`. Its map code (MapLibre + OpenFreeMap restyle, clustering, synced list) is reusable; e.g. `docs/design/round-1/b-photobooth/screens.html`.
- Screenshot helper: `node /tmp/claude-1000/-home-sakiaya-travel/dfd1d219-8da1-4b94-af85-e665af879cfb/scratchpad/design-r1/shot.mjs <html> <out.png> <w> <h> <light|dark> [full]`.

## Product in one breath
Zach texts this link to his date. On her phone she browses places he saved (map and list, filtered), hearts what sounds fun, and sends her picks back (share link, or copied text). Also "Shows coming up": live DJ/concert listings from 19hz.info.

## Truth rules (hard)
- Only real places/lists/notes from sample.json. Never invent places, ratings, prices, reviews or claims. His notes are his words; show them as his ("Zach's note").
- The 4 shared lists (SF, Sac, Bay Area, NYC) are called "Other lists" (never "friends"). Source toggle: "My lists / Other lists". Other lists' places are categorized into the same categories as his lists (Casual Food, Bakery, Tea/Drinks, Museums, Parks...); category filters work across both sources and every place uses its category's icon and colour whatever the source. The real categorization file is not ready: use a handful of other-list places whose category is obvious from the name, mark them "provisional category" in notes.md, and leave the rest uncategorized (shown under an "Other lists" grey icon).
- "Been" only where the data says so. Old Sacramento Waterfront (curated, been) may carry approximate coordinates labeled "Sacramento picks", disclosed in notes.md.
- Never show trip dates, tickets, bookings, profile, allergies or food flags. Hotels and Parking Lots are just saved lists, and must be filterable like every list (all 28).
- Shows: the snapshot rows as they are, credited "Listings from 19hz.info", marked "snapshot, 24 Nov".
- Authored copy in a warm first-person voice from Zach, short. Don't use the word "date" on the page.

## Palette (zli-ppr-custom, RGB)
- mauve 200 248,244,246 · 300 217,198,208 · 400 186,153,170 · 500 155,107,132 · 600 132,89,111 · 700 108,73,91 · 800 83,56,70 · 900 59,40,50
- rose 50 255,241,242 · 100 255,228,230 · 200 254,205,211 · 300 253,164,175 · 400 251,113,133 · 500 244,63,94 · 600 225,29,72 · 700 190,18,60 · 800 159,18,57 · 900 136,19,55
- lavender-grey 200 249,249,251 · 300 205,205,219 · 400 160,160,187 · 500 116,116,155 · 600 96,96,134 · 700 79,79,110 · 800 62,62,86 · 900 45,45,63
- Filled buttons with white text: rose-600 or darker (AA). In dark mode a filled rose-400/300 button takes dark text instead. Body text AA in both themes. Light ground: a very light lavender or white, not cream. Dark ground: deep plum/aubergine (mauve-900 family, darkened), not pure black.
- All colours as custom properties on `:root`, dark override via `prefers-color-scheme` plus a working toggle (`data-theme`).

## Craft floor (hard)
- Real size: phone 390x844, desktop 1440x900. No horizontal page scroll at 390 (chip rows may scroll inside themselves). Tap targets at least 44x44. Text at least 12px.
- No kicker/eyebrow labels, no all-caps labels, no coloured border-left/top stripes, no gradient text, no glass as decoration, no hard offset shadows, no emoji/unicode as icons (authored SVG icons, one consistent stroke and corner style), no hero headline + button + row of equal cards.
- Fonts: Google Fonts OK in prototypes. Choose ONE friendly UI family from: Figtree, Nunito, M PLUS Rounded 1c, Rubik, Onest (optionally a second only for the wordmark). Not Inter/DM Sans/Outfit/Plus Jakarta/Space Grotesk.
- Theme the browser surfaces (selection, focus-visible ring, scrollbars). Hearts are buttons with `aria-pressed` and a label naming the place. `prefers-reduced-motion` turns every animation into an instant state change.

## Icons (the main cute accent)
Author a small consistent SVG set: one per list group (food, bakery/desserts may share "sweet", boba/tea, drinks/nightlife, shopping, sights/culture, parks/outdoors, activities/sports, hotels, parking, friends) plus UI icons (map, list, filter, heart, share, copy, shows/music, close, search, theme). Rounded strokes, slightly chubby, a small cute detail each (a boba cup with pearls, a tree with a round crown, a croissant), never faces or mascots. Group icons sit in soft tinted circles/rounded squares.

## Map
MapLibre GL JS 4.7.1 (unpkg) + OpenFreeMap `positron` style (open data, no key), restyled CALM: light = soft lavender-white land, pale lavender water, white roads, quiet labels; dark = deep plum land, darker water, muted roads. NO CLUSTERING (owner: "I don't want tiles to group, I want to be able to easily explore"): every place is its own pin at every zoom; pins never merge into count bubbles. Use a GeoJSON source WITHOUT cluster and draw pins as MapLibre `circle` layers (small, light, coloured by list group, white stroke) so ~2,000 stay smooth; show more as she zooms (radius grows with zoom; at high zoom add a symbol layer with the group icon and the name label). Tapping a pin opens a quick peek card; swiping the peek card moves between nearby places (a plus). Moving the map updates the list ("N places in this area"). Filter chips toggle without leaving the map. Credit "© OpenStreetMap contributors · OpenFreeMap". Fallback ground if tiles fail.

## Browse
One continuous scrollable feed she can wander through, narrowed by filters and search. No category sections or folders she has to open.

## Micro-interaction (must work on the phone prototype)
Heart tap: pop (scale 1 → 1.25 → 1 spring-ish, ~350ms) with a tiny burst (3-6 small hearts/dots) that fades; fill turns rose. The picks counter (in the tab bar, a floating pill or header) wiggles/bumps and its number rolls. Un-heart: soft shrink. Tapping the counter opens the picks sheet (bottom sheet on phone) with "Send to Zach" (share link encoding picks, Web Share API with copy fallback) and "Copy as text", plus a friendly empty state when there are no picks.

## Deliverables in `docs/design/round-2/<slug>/`
1. `phone.html`: 390x844. The landing state, plus working: hearts, counter, picks sheet, map/list toggle, filters (bottom sheet or chips: group, all 28 lists incl. Hotels and Parking Lots, region, from friends on/off, hide been), place detail (tap a place), Shows view. One file, all states reachable by tapping.
2. `desktop.html`: 1440x900, map + synced list + filters + picks, same system.
3. Screenshots (look at every one, fix what's broken): `phone-light.png`, `phone-dark.png` (landing), `phone-states.png` (a board: render 4 more phone states side by side at 390x844 each: filters open, place detail with heart, picks sheet with 4-5 picks, shows; at least two in dark; you may produce this with a separate `states.html` that iframes or duplicates phone.html in preset states), `desktop-light.png`, `desktop-dark.png`.
4. `notes.md` (short): font, icon list, the micro-interactions as motion grammar (trigger, motion, duration/easing, reduced-motion fallback), synthetic items, risks.

Report in under 10 lines: files, one line each, top risk.

## Readable pins (owner: "It should be easy to tell what each pin or map icon is")
- Each pin shows its CATEGORY icon inside the pin (one icon per category/list, not per group: fork for casual food, plate+cloche for sit down, croissant for bakery, ice cream for desserts, cup with pearls for tea/boba, glass for bar, bag for shopping, hanger for clothing, basket for grocery, star/pin for points of interest, camera for tourist attractions, landmark for museums, music/ticket for venues, road sign for roadside, tree for parks, boot for hiking, path for trails, sparkle for activities, ball for sports, target for guns, bed for hotels, P for parking). Colour comes from the category group; the icon makes it readable on its own.
- Implementation: register each icon as a map image (draw the SVG into a canvas, `map.addImage(id, imageData, {pixelRatio: 2})`) and use a `symbol` layer for pins from about zoom 11.5 up (pin disc in group colour + white icon). Below that, a small `circle` in the group colour only. No clustering. Allow overlap (`icon-allow-overlap: true`) so pins never vanish.
- Test icons at pin size (about 22-26px disc, 14px glyph) and large; they must stay distinct.
- Always-reachable legend on the map (a small "Key" chip opens it): icon + colour + category name. The filter chips use the same icons so they double as the legend.
- Tap (phone) or hover (desktop) on a pin shows the place name plus its category label in the peek card.
- Extra deliverable: `icons.html` + `icons.png`: every category icon at pin size (inside its pin disc, light and dark) and large (48px), with its name, plus the legend as it appears in the UI.
