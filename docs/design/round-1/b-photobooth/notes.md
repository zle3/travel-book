# B: Photo Booth Sticker Sheet

Fonts (Google Fonts): Bagel Fat One (title stamp, big note text, dates), Gaegu 700 (gel-pen handwriting: his notes, greetings, counts), Figtree (body).
World: light = pale lavender sticker backing sheet (printed grid, dotted peel slits); dark = plum booth curtain with rose ring-light glow. Stickers stay white-bordered in both.

Doodle set: 8 authored SVG symbols (food bowl, drinks boba, shopping tote, sights bridge, outdoors mountain, activities tennis ball, hotels/parking suitcase, friends speech bubbles), one stroke weight, group tint behind. Friends' stickers get a holographic sheen and a "From a friend's list" tag; friends' map markers get a holo border.

Signature interaction (heart stamp): trigger tap on a heart. A puffy epoxy heart appears on the sticker corner, scale 1.15 to 1 and opacity 0 to 1 over 220ms, cubic-bezier(.16,.84,.3,1); 8 drawn spark strokes draw in and fade over 600ms ease-out. The "N picks" tab peels its corner (11px to 26px to 11px, 550ms) whenever the count changes, including un-hearting. Reduced motion: heart appears instantly, no sparks, no peel. Heart is a button with aria-pressed and a label naming the place.

Working in index.html: hearts, live count, Mine / From friends toggles, picks tab opens "Our strip" drawer (4 to 6 frames, remove, Send to Zach via share sheet or copied link, Copy as text), theme toggle (stored). screens.html and desktop.html have a live MapLibre map (positron restyled in JS to lavender/mauve or plum, white roads in light), sticker markers, stacked-sticker clusters with a gel-pen count, filters by list (incl. Hotels, Parking Lots), group, region, friends toggle, hide been, and a synced list.

Synthetic: Old Sacramento Waterfront (his curated note, "been" true) was added with approximate coordinates and listed as "Sacramento picks" (his curated list) only to demo hide-been. "Our strip" picks in screens are demo picks. The share link is just the page URL plus ids. Shows are the 19hz.info snapshot rows as given (24 Nov).

Risks: most familiar "cute" answer; Sanrio/childish drift if the doodles stay this round and the pen face gets loud. Friends' doodle does not say what the place is. Map is dense at SF zoom; clusters carry it. Fonts load from Google (production should self-host).
