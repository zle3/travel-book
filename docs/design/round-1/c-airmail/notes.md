# C, Par Avion (round 1)

Fonts (Google): Gloock (engraved display: wordmark, stamp names, denominations), Caveat (Zach's notes and her letter), Figtree (body, chips, lists).

Signature: the heart is a wax seal.
- Trigger: tap the ring on a stamp (button, aria-pressed, label "Seal <place> on your letter").
- Seal presses: rose wax seal drops from scale 1.3 and 8px up with a wide soft shadow, hits with a slight squash (0.93 x 0.88), settles to 1 with a tight shadow. 260ms, cubic-bezier(.16,1,.3,1). The dashed ring fades out at the same time.
- Untap: seal lifts (scale 1.15, up 7px, fades) in 180ms ease-in, ring fades back in.
- Envelope counter: number updates live; the sealed stamp slips into the envelope peek (translate up 18px to 0, 320ms, same ease-out). Picks, letter lines and map markers (small seal on the postmark) all follow.
- Reduced motion: no animation; seal and peek stamps swap state instantly, sheet does not slide.

Synthetic or authored: greeting copy, "par avion", "Zach to you" postmark text, letter wording ("Dear Zach", "See you soon, xo"), the 8 engraved vignettes, perforation, postmarks. Index starts with 2 stamps already sealed and screens/desktop with 5, only to show the state (a real first visit starts at 0). Place areas come from the address city, or the map position when the address is empty. "Hide been" is wired but sample places carry no been flag, so it has no visible effect here. The map and picks use real SF-window places plus places with notes; friends' places are dashed stamps/markers with a "From friends" issue mark and toggle separately. Shows are the 19hz.info snapshot rows, shown for SF and Oakland, credited.

Honest risks
- Stamps in a grid are the whole product, so the page relies on the vignettes carrying charm; repeated vignettes per group (all food stamps share the bowl) may feel samey at scale.
- Vintage drift: held off by saturated rose chevron edges, crisp white stamps and big type, but the dark theme with liner pattern is the closest to wedding-stationery.
- Clusters stamped with wavy cancel lines get busy at low zoom (2,081 places); needs a cap in production.
- Map text for postmark arcs is 12px, decorative.
