# Direction A, The Sampler (round 1)

Fonts: Bricolage Grotesque (body, names, woven labels; variable width and weight) and Patrick Hand (his notes and greeting, as embroidered name tags). Title "Little Travel Book" is a mixed-case 5x7 bitmap font (lowercase x-height 5 rows) drawn as cross stitches in SVG (thread colours rose / mauve / lavender, sheen stroke on each leg).

Cloth: dyed pale mauve-lavender linen (light) and deepened aubergine linen (dark), CSS weave + slub noise. One bolt of cloth: map, list, sheets share it; the place detail and picks sheet are patches with a running-stitch edge.

## Signature interaction: the cross-stitch heart
- Trigger: tap/Enter on a heart button (aria-pressed, labelled "Heart <place>").
- Empty state: the heart chart is printed on the aida in thin dashed X ghosts; hover darkens the print.
- Fill: 72 legs, all "/" legs first row by row (left to right), then all "\" legs. Each leg draws with stroke-dashoffset, 90ms linear each, 7.5ms stagger, total about 650ms. Linear ease = thread pulled taut, no spring or overshoot.
- Unpick: reverse order, 60ms each, 3.5ms stagger, about 300ms.
- Side effects in the same stroke: the thread on the needle bar lengthens (dash reveal, 500ms ease-out, knot rides the end), the count updates, and a new stitched row of X's appears on "Your sampler" (row stitches in left to right with steps()).
- Reduced motion: all transitions and animations off, states swap instantly.

## Challenger points
Unlit states are printed ghosts (hearts, unselected spools); no springs; every list has its own spool (24 his + separate "From friends" rack of 4, horizontally scrollable); no cards, patches only; zones named on sew-in labels (Places, Map, Shows, Your picks); actions change the object in one stroke.

## Map
MapLibre + OpenFreeMap positron restyled after load: linen ground, lavender water with cross-hatch pattern, roads as thin dashed mauve running stitch, quiet place labels, clutter hidden. Markers: his lists = cross-stitch X, friends' lists = French knot, hearted = tiny stitched heart above the marker, clusters = four-hole sewing buttons with the count. If the remote style fails, a fallback style (rough hand-made bay and ocean polygons) keeps the linen ground and markers.

## Synthetic / assumptions
- Places, lists, notes, shows are from sample.json only. Show rows marked "snapshot, 24 Nov", credited to 19hz.info.
- Old Sacramento Waterfront (the only `been` entry) comes from his curated Sacramento database, so it carries its own source "Sacramento picks" (not one of the 28 Google lists, no spool). It has no coordinates in the data; I gave it an approximate coordinate so the "hide places Zach has been" filter has something to act on. Replace with a real one in production.
- Friends' list notes (e.g. "Duck!") are labelled "Note on the list", not "Zach's note".
- Pre-seeded picks (5 on screens.html, 3 on desktop.html, 2 clicked in index-light.png) are demo state, not real picks. index-dark.png shows the empty state.
- Send to Zach builds a `#picks=` link (index ids, demo format); Copy as text uses the clipboard.

## Honest risks
- Embroidery can go twee. Held back by the large crisp title, flat linen, hard palette, young copy; still the most doily-adjacent part is the running-stitch edges and the spool rack.
- Landing revised: racks moved off the landing (one row: Zach's lists / From friends toggles + "All 28 lists" link to the map filter view); 5 rows visible at 390x844. Racks stay on the map screen and desktop. Hearts are about 52px wide.
- Spool band labels are 12px condensed; long names wrap to two lines.
- 266 heart SVGs of 72 lines each is fine here but the production list should virtualise.
