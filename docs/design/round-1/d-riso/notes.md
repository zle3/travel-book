# D: Two-Ink Zine (round 1)

Fonts (Google, prototype only): Shrikhand (display, two offset ink layers; poster-script voice), Caveat Brush (hand lettering: notes, numbers, nav), Bricolage Grotesque (body).

Signature interaction: the heart is a rose rubber stamp.
- Trigger: tap/click or Enter/Space on the heart button (aria-pressed toggles).
- Moves: dashed stamp guide (mauve over rose, 2px misregistered) is replaced by a rose heart with a grainy SVG-noise mask (feTurbulence threshold), per-place rotation (-11 to +11deg). It lands from scale 1.55 to 1 in 180ms, cubic-bezier(.2,.9,.25,1). Then it "dries" over 400ms: saturate 1.7 / brightness 1.18 and a white gloss at 60% fade to matte. Overprint uses mix-blend-mode multiply (screen in dark).
- Untap: ink fades out in 220ms ease-out. The circled picks number in the corner updates live (no animation).
- Reduced motion: no animation or transition; the ink is simply present or absent.

Map: MapLibre positron restyled after load (land = halftone dot pattern generated on canvas, water = solid low-density rose, roads thin mauve, labels only for neighbourhoods). Pins are canvas-drawn wobbly circled numbers, clusters are halftone blobs with the count knocked out. If tiles fail, a crude stylised SF outline (fallback only, not geographic data) keeps the page from showing a grey box.

Numbers: a place's number is its position in the zine list (his 11 featured places first, the rest of his SF lists, then friends' picks). Friends' places carry a "from a friend" tag and toggle separately.

Synthetic / authored: greeting, margin notes, button copy, "tear here", picks pre-set to 5 places for screens and desktop (a demo state), share link format (?picks=1,2,3 on the same page). Region select flies the map, but the sample only holds SF pins (others show the empty state). "Hide places I have been" is wired as a toggle but the sample carries no been flag for these places, so it filters nothing. Shows: 6 real rows from the 24 Nov 19hz.info snapshot, credited. No addresses invented: the where line is his list name plus an address only when the data has one.

Honest risks
- Loud and graphic: could read cool-hipster zine fair rather than romantic; warmth rests on hand notes, hearts and the "xo Zach" voice.
- Grain over the paper sits under text, but light-mode grain slightly softens small text; check on a real phone.
- Caveat Brush is condensed; numerals read well, long hand notes are narrower than a looser script.
- Map pattern fills can moire at some zooms; land dots were kept faint on purpose.
- Detail art is one authored egg-tart illustration; other places have no illustration yet.
