/* Little Travel Book, map configuration (round 3).
   ES module, no dependencies. MapLibre GL JS 4.7.1. Everything the map needs besides data and DOM.
   Pure functions: buildStyle() returns a full style object; call map.setStyle(buildStyle(...)) to switch theme or
   light/dark, then re-add pin images (registerPinImages) on 'style.load' and 'styleimagemissing'.

   Rules baked in (owner, 2026-11-24):
   - NO clustering. One GeoJSON source, every place its own feature at every zoom.
   - Low zoom: small group-coloured dots whose radius grows with zoom. Category icon from ZOOM.iconIn (13.5).
   - Draw order via sort keys: hearted (3) > my lists (2) > other lists (1). Higher rank draws on top.
   - Labels only from ZOOM.labels, with collision (no allow-overlap) so they never pile up.
   - Pins stay legible on standard light and dark: white ring plus a soft dark halo. */

export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';   // OpenFreeMap, open data, no key

/* Attribution strings (render in a small credit line; keep it visible, never hidden behind sheets). */
export const ATTRIBUTION = {
  standard: '© OpenStreetMap contributors · OpenFreeMap',
};

/* Satellite was DROPPED by the owner (no third-party imagery). The map style follows light/dark only. */

/* Zoom ladder. Round 2 swapped to icons at 11.2 and crowded SF; 13 keeps dots calm through the dense core and still shows icons at neighbourhood zoom. */
export const ZOOM = {
  dotsOut: 13.4,      // dots fully gone
  iconIn: 13,         // category icons start (fade 13 to 13.5); dots below
  labels: 15.6,       // place-name labels
  fly: 15,            // zoom used when flying to a chosen place
  denseHint: 14,      // show the "Lots here" chip below this zoom...
  denseCount: 250,    // ...when more than this many places are in view
};

/* ---------- Basemap theme as Protomaps FLAVOR colour objects ----------
   Production basemap = self-hosted Protomaps PMTiles (regional extract); no third-party tile service. With @protomaps/basemaps:
       import { layers } from '@protomaps/basemaps';   const style = layers('protomaps', FLAVOR[theme], { lang: 'en' });
   Keys below are the Flavor fields we override (anything omitted inherits the stock 'light'/'dark' flavor).
   The prototype still renders OpenFreeMap positron (we cannot host PMTiles in a mock), restyled by restyleStandard() from the SAME values:
     OpenFreeMap layer id                       -> Flavor key
     background                                 -> background (and earth)
     water, waterway                            -> water
     park, landcover_wood                       -> park_a, wood_a
     landuse_residential                        -> earth (slightly lifted)
     building                                   -> buildings
     highway_* / road fills (minor, major)      -> minor_a, minor_b, major, highway (all one road colour, calm)
     *_casing                                   -> minor_casing, major_casing_late, highway_casing_late
     label_* / highway-name-* / water_name*     -> city_label, subplace_label, roads_label_minor, roads_label_major, ocean_label, waterway_label
     text-halo                                  -> *_halo keys (city_label_halo, subplace_label_halo, roads_label_*_halo)
   Hidden in both: boundaries, railway, pier, airport shields (set to transparent / omit the layers). */
export const FLAVOR = {
  light: { background: '#f1effa', earth: '#f1effa', water: '#d5daf3', park_a: '#e6e9f4', park_b: '#e6e9f4', wood_a: '#e6e9f4', wood_b: '#e6e9f4', buildings: '#e8e4f2',
           minor_a: '#ffffff', minor_b: '#ffffff', link: '#ffffff', major: '#ffffff', highway: '#ffffff', other: '#ffffff',
           minor_casing: '#e0dbee', major_casing_late: '#e0dbee', highway_casing_late: '#e0dbee', pedestrian: '#f1effa', railway: 'transparent', boundaries: 'transparent',
           city_label: '#6d5c7c', city_label_halo: '#ffffff', subplace_label: '#6f5f80', subplace_label_halo: '#ffffff', roads_label_minor: '#6f5f80', roads_label_minor_halo: '#ffffff',
           roads_label_major: '#6f5f80', roads_label_major_halo: '#ffffff', ocean_label: '#7d86b8', waterway_label: '#7d86b8' },
  dark:  { background: '#2a1d28', earth: '#2f2230', water: '#1b1a2f', park_a: '#31232f', park_b: '#31232f', wood_a: '#31232f', wood_b: '#31232f', buildings: '#352633',
           minor_a: '#4c3848', minor_b: '#4c3848', link: '#4c3848', major: '#4c3848', highway: '#4c3848', other: '#4c3848',
           minor_casing: '#201520', major_casing_late: '#201520', highway_casing_late: '#201520', pedestrian: '#2f2230', railway: 'transparent', boundaries: 'transparent',
           city_label: '#d9c6d0', city_label_halo: '#2a1d28', subplace_label: '#c0a9b9', subplace_label_halo: '#2a1d28', roads_label_minor: '#c0a9b9', roads_label_minor_halo: '#2a1d28',
           roads_label_major: '#c0a9b9', roads_label_major_halo: '#2a1d28', ocean_label: '#8f8ec0', waterway_label: '#8f8ec0' },
};
const fromFlavor = (f, extra) => ({ bg: f.background, water: f.water, park: f.park_a, land: f.earth, road: f.minor_a, casing: f.minor_casing, build: f.buildings, text: f.subplace_label, halo: f.subplace_label_halo, ...extra });
/* Palettes drive restyleStandard (prototype) and pins; mirror tokens.css --map-* (MapLibre cannot read CSS variables). */
export const PALETTE = {
  light: fromFlavor(FLAVOR.light, { pinHalo: 'rgba(59,40,50,.22)', sel: '#6c495b', name: '#4a3340', user: '#2f6fd6' }),
  dark:  fromFlavor(FLAVOR.dark,  { pinHalo: 'rgba(0,0,0,.4)', sel: '#f6ecf2', name: '#f1e4eb', user: '#6aa2ff' }),
};
export const HEART = '#f43f5e', BEEN = '#2f7d6b';

/* ---------- Standard: OpenFreeMap positron restyled calm. layer id -> paint ---------- */
export function restyleStandard(base, theme) {
  const c = PALETTE[theme];
  const s = JSON.parse(JSON.stringify(base));
  s.layers.forEach((l) => {
    l.paint = l.paint || {};
    const id = l.id, ty = l.type;
    if (ty === 'background') l.paint['background-color'] = c.bg;
    else if (ty === 'fill') {
      if (id === 'water') l.paint['fill-color'] = c.water;
      else if (id === 'park' || id === 'landcover_wood') { l.paint['fill-color'] = c.park; l.paint['fill-opacity'] = 0.9; }
      else if (id === 'landuse_residential') { l.paint['fill-color'] = c.land; l.paint['fill-opacity'] = 0.7; }
      else if (id === 'building') { l.paint['fill-color'] = c.build; l.paint['fill-opacity'] = 0.6; delete l.paint['fill-outline-color']; }
      else if (id === 'road_area_pier') l.paint['fill-color'] = c.road;
      else l.layout = { ...(l.layout || {}), visibility: 'none' };
    } else if (ty === 'line') {
      if (/boundary|aeroway|railway|tunnel|path|pier|subtle/.test(id)) l.layout = { ...(l.layout || {}), visibility: 'none' };
      else if (id === 'waterway') l.paint['line-color'] = c.water;
      else if (/casing/.test(id)) { l.paint['line-color'] = c.casing; l.paint['line-opacity'] = theme === 'dark' ? 0.9 : 0.6; }
      else { l.paint['line-color'] = c.road; delete l.paint['line-opacity']; }
    } else if (ty === 'symbol') {
      if (/airport|shield|path/.test(id)) l.layout = { ...(l.layout || {}), visibility: 'none' };
      else { l.paint['text-color'] = c.text; l.paint['text-halo-color'] = c.halo; l.paint['text-halo-width'] = 1.6; }
    }
  });
  return s;
}

/* ---------- Pin layers (appended after the base layers, so pins sit above map labels) ---------- */
/* Feature properties expected on the 'places' source:
   { id, n (name), ic ('pin-<category>'), col (group colour), rank (3 hearted, 2 mine, 1 other), been (bool) } */
export function pinLayers({ theme = 'dark', picks = [], hasGlyphs = true } = {}) {
  const pal = PALETTE[theme];
  const pre = 'pin-';
  const none = ['==', ['get', 'id'], -1];
  const iconSize = ['interpolate', ['linear'], ['zoom'], 13, 0.78, 15, 0.92, 17, 1.08, 19, 1.2];
  const fade = ['interpolate', ['linear'], ['zoom'], ZOOM.iconIn, 0, ZOOM.iconIn + 0.5, 1];
  const dotFade = ['interpolate', ['linear'], ['zoom'], 12.9, 1, ZOOM.dotsOut, 0];
  const dotRad = (add = 0) => ['interpolate', ['linear'], ['zoom'], 8, 2.2 + add, 11, 3.2 + add, 12.5, 4.6 + add, 13, 6 + add];   // radius scales with zoom (zoom may only feed a top-level interpolate)
  const dotR = dotRad();
  const L = [
    // soft dark halo under every dot: keeps colours separable on the pale map
    { id: 'dots-halo', type: 'circle', source: 'places', maxzoom: ZOOM.dotsOut,
      layout: { 'circle-sort-key': ['get', 'rank'] },
      paint: { 'circle-color': pal.pinHalo, 'circle-radius': dotRad(2.6), 'circle-blur': 0.8, 'circle-opacity': dotFade } },
    { id: 'dots', type: 'circle', source: 'places', maxzoom: ZOOM.dotsOut,
      layout: { 'circle-sort-key': ['get', 'rank'] },   // hearted on top, then mine, then other
      paint: { 'circle-color': ['get', 'col'], 'circle-radius': dotR, 'circle-stroke-color': '#ffffff',
               'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 13, 1.8], 'circle-opacity': dotFade, 'circle-stroke-opacity': dotFade } },
    { id: 'dots-heart', type: 'circle', source: 'places', maxzoom: ZOOM.dotsOut, filter: ['==', ['get', 'rank'], 3],
      paint: { 'circle-color': HEART, 'circle-radius': dotRad(2), 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2, 'circle-opacity': dotFade, 'circle-stroke-opacity': dotFade } },
    { id: 'sel-halo', type: 'circle', source: 'places', filter: none,
      paint: { 'circle-color': pal.sel, 'circle-opacity': 0.2, 'circle-radius': 24, 'circle-stroke-color': pal.sel, 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.8 } },
    // category icon pins: disc in group colour + white glyph + white ring + soft dark halo (baked into the image)
    { id: 'pins', type: 'symbol', source: 'places', minzoom: ZOOM.iconIn,
      layout: { 'icon-image': ['concat', pre, ['get', 'cat']], 'icon-size': iconSize, 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'rank'] },
      paint: { 'icon-opacity': fade } },
    { id: 'pins-sel', type: 'symbol', source: 'places', filter: none,
      layout: { 'icon-image': ['concat', pre, ['get', 'cat']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 1.2, 13, 1.35, 17, 1.5], 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
    // hearted: small rose heart badge at the top-right; been: small teal check badge at the bottom-right
    { id: 'pins-heart', type: 'symbol', source: 'places', minzoom: ZOOM.iconIn, filter: ['==', ['get', 'rank'], 3],
      layout: { 'icon-image': 'heart-badge', 'icon-size': iconSize, 'icon-offset': [14, -14], 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
    { id: 'pins-been', type: 'symbol', source: 'places', minzoom: ZOOM.iconIn, filter: ['==', ['get', 'been'], true],
      layout: { 'icon-image': 'been-badge', 'icon-size': iconSize, 'icon-offset': [14, 14], 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
    // been on a dot (low zoom): a small ring so it is still quiet but findable
    { id: 'dots-been', type: 'circle', source: 'places', maxzoom: ZOOM.dotsOut, filter: ['==', ['get', 'been'], true],
      paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-radius': dotRad(2.4), 'circle-stroke-color': BEEN, 'circle-stroke-width': 2, 'circle-stroke-opacity': dotFade } },
    // Michelin layer (US-wide, OFF by default): unsaved points. Tiny dots at national zoom, outlined award pins at city zoom.
    // Saved places always draw above (these layers are inserted BEFORE the saved dots/pins, see buildStyle).
    // the visitor's own location (Locate me)
    { id: 'user-acc', type: 'circle', source: 'user', paint: { 'circle-color': pal.user, 'circle-opacity': 0.14, 'circle-radius': 0, 'circle-stroke-color': pal.user, 'circle-stroke-width': 1, 'circle-stroke-opacity': 0.35 } },   // radius set by userAccuracyRadius()
    { id: 'user-pulse', type: 'circle', source: 'user', paint: { 'circle-color': pal.user, 'circle-opacity': 0.4, 'circle-radius': 8 } },   // animated by pulseUser(); static under reduced motion
    { id: 'user-dot', type: 'circle', source: 'user', paint: { 'circle-color': pal.user, 'circle-radius': 7, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } },
  ];
  if (hasGlyphs) L.push({ id: 'pin-names', type: 'symbol', source: 'places', minzoom: ZOOM.labels,
    layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-max-width': 8,
              'text-optional': true, 'symbol-sort-key': ['-', 0, ['get', 'rank']] /* collision winners: hearted first */ },
    paint: { 'text-color': pal.name, 'text-halo-color': pal.halo, 'text-halo-width': 1.7 } });
  return L;
}

/* Full style for the current theme + mode. data = GeoJSON FeatureCollection of places. */
export function buildStyle(base, { theme = 'dark', data, picks = [], michelinData = null, michelinOn = false, michelinFilter = null } = {}) {
  const s = restyleStandard(base, theme);
  s.sources.places = { type: 'geojson', data };                 // NO cluster option, on purpose
  s.sources.user = { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
  s.sources.michelin = michelinData ? { type: 'geojson', data: michelinData } : MICHELIN_SOURCE;   // prototype passes synthetic GeoJSON; production passes nothing (PMTiles)
  const pins = pinLayers({ theme, picks, hasGlyphs: !!base.glyphs });
  // order: michelin layer first (underneath), then saved dots/pins on top
  const ml = michelinLayers(michelinOn, michelinFilter);
  if (michelinData) ml.forEach((l) => delete l['source-layer']);   // GeoJSON demo source has no source-layer
  s.layers.push(...ml, ...pins, ...michelinBadgeLayer());
  return s;
}

/* Feature builder: one place -> GeoJSON feature. rank: hearted 3, my lists 2, other lists 1. */
export function toFeature(p, { hearted = false, groupColor } = {}) {
  return { type: 'Feature', properties: { id: p.i, n: p.n, cat: p.c, col: groupColor, rank: hearted ? 3 : (p.s === 'm' ? 2 : 1), been: !!p.b, mich: !!(p.mi && p.mi.length) },
           geometry: { type: 'Point', coordinates: [p.lng, p.lat] } };
}

/* ---------- Pin images: draw SVG to canvas, map.addImage(id, imageData, {pixelRatio: 2}) ---------- */
/* glyphs: { [categoryId]: '<path .../>' } from icons.svg inner markup (classes .f = soft fill, .s = solid). */
export const pinSVG = (glyph, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><style>.f{fill:#fff;fill-opacity:.28}.s{fill:#fff;stroke:none}</style>
<circle cx="32" cy="33" r="29" fill="rgba(0,0,0,.2)"/><circle cx="32" cy="32" r="28.5" fill="rgba(0,0,0,.1)"/>
<circle cx="32" cy="32" r="26" fill="#fff"/><circle cx="32" cy="32" r="22.5" fill="${color}"/>
<g transform="translate(15.5 15.5) scale(1.35)" fill="none" stroke="#fff" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${glyph}</g></svg>`;
export const heartBadgeSVG = (path) => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="21" r="18" fill="rgba(0,0,0,.25)"/><circle cx="20" cy="20" r="17" fill="#fff"/><g transform="translate(8.4 8.4) scale(1.1)"><path d="${path}" fill="${HEART}" stroke="${HEART}" stroke-width="2" stroke-linejoin="round"/></g></svg>`;
export const beenBadgeSVG = () => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="21" r="18" fill="rgba(0,0,0,.25)"/><circle cx="20" cy="20" r="17" fill="#fff"/><circle cx="20" cy="20" r="13" fill="${BEEN}"/><path d="M13.5 20.5l4.6 4.6 8.4-9.4" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export function svgToImageData(svg, px) {
  return new Promise((res) => { const im = new Image(); im.onload = () => { const cv = document.createElement('canvas'); cv.width = cv.height = px; const x = cv.getContext('2d'); x.drawImage(im, 0, 0, px, px); res(x.getImageData(0, 0, px, px)); }; im.onerror = () => res(null); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
}
export async function loadPinImages({ categories, glyphs, groupColors, heartPath }) {
  const out = {}; const jobs = [];
  Object.keys(categories).forEach((k) => {
    const col = groupColors[categories[k].group];
    jobs.push(svgToImageData(pinSVG(glyphs[k], col), 64).then((d) => { out['pin-' + k] = d; }));
  });
  jobs.push(svgToImageData(heartBadgeSVG(heartPath), 40).then((d) => { out['heart-badge'] = d; }));
  jobs.push(svgToImageData(beenBadgeSVG(), 40).then((d) => { out['been-badge'] = d; }));
  await Promise.all(jobs); return out;
}
export function registerPinImages(map, images) { Object.entries(images).forEach(([k, v]) => { if (v && !map.hasImage(k)) map.addImage(k, v, { pixelRatio: 2 }); }); }

/* Dense-area hint: show the chip when inViewCount > ZOOM.denseCount and zoom < ZOOM.denseHint, until dismissed. */
export const shouldHintDense = (inViewCount, zoom, dismissed) => !dismissed && zoom < ZOOM.denseHint && zoom > 9 && inViewCount > ZOOM.denseCount;

/* ---------- Michelin layer (owner, 2026-11-24): WORLDWIDE, ~15-20k restaurants, including unsaved ones ----------
   Architecture (must not lag): MapLibre GPU circle + symbol layers only, never DOM markers, NO clustering.
   Data = ONE PMTiles vector file, fetched by HTTP range requests, only for tiles in view, and only after the toggle is first switched on.
   Register the protocol once before creating the map:
       import { Protocol } from 'pmtiles'; maplibregl.addProtocol('pmtiles', new Protocol().tile);
   Tile feature properties (minimal): id, best ('3s'|'2s'|'1s'|'bib'|'green'|'sel'), yr (latest year), name (labels at high zoom).
   Full awards-by-year load on tap from a per-id lookup, then render in the peek / place card.
   Unsaved = OUTLINE pin (ring in the best-award colour, light centre, rosette glyph); saved places keep their FILLED category pin and gain the small
   award badge. Saved layers are added AFTER these, so saved always draw above. We draw our own neutral rosette; never Michelin's logos. */
export const MICHELIN_SOURCE = { type: 'vector', url: 'pmtiles://michelin.pmtiles', minzoom: 0, maxzoom: 14, attribution: 'Michelin Guide data (sample in this prototype)' };
export const MICHELIN_SOURCE_LAYER = 'michelin';
/* Award colour scale: in-family, distinct, each >= 4.5:1 against white (ring and badge sit on a white halo, so they read on standard lightand dark).
   Stars amber, Bib teal-blue, Green Star green, Selected stone. 1/2/3 stars share the star colour; 3 stars draw slightly larger. */
export const AWARD = {
  star:  { color: '#b45309', label: 'Michelin Star' },
  bib:   { color: '#0e7490', label: 'Bib Gourmand' },
  green: { color: '#15803d', label: 'Green Star' },
  sel:   { color: '#78716c', label: 'Selected' },
};
export const MICHELIN_COLOR = AWARD.star.color;
export const awardKind = (best) => (/s$/.test(best) ? 'star' : best);
const colorBy = ['match', ['get', 'best'], ['3s', '2s', '1s'], AWARD.star.color, 'bib', AWARD.bib.color, 'green', AWARD.green.color, AWARD.sel.color];
const iconBy = ['match', ['get', 'best'], ['3s', '2s', '1s'], 'mich-star', 'bib', 'mich-bib', 'green', 'mich-green', 'mich-sel'];
/* Chip filter expressions. Chips: "Michelin stars" -> ['3s','2s','1s'], "Bib Gourmand" -> ['bib'], plus Green Star / Selected in the Filters sheet.
   'any year' (2022-2026) uses every feature; 'current edition' adds yr == CURRENT_EDITION. With the layer off the same chips filter saved places. */
export const CURRENT_EDITION = 2025;   // set to the latest edition present in the data (prototype sample uses 2025)
export const michelinFilter = ({ bests = [], currentOnly = false } = {}) => {
  const f = ['all'];
  if (bests.length) f.push(['in', ['get', 'best'], ['literal', bests]]);
  if (currentOnly) f.push(['==', ['get', 'yr'], CURRENT_EDITION]);
  return f.length === 1 ? null : f;
};
ZOOM.michelinBadge = 15;     // award badge on saved pins (high zoom only)
ZOOM.michelinPins = 9.5;     // outlined award pins from here; tiny best-award dots below (z0 to 9.5)
export const michelinLayers = (visible = false, filter = null) => {
  const vis = { visibility: visible ? 'visible' : 'none' };
  const dotR = ['interpolate', ['linear'], ['zoom'], 0, 1.8, 3, 2.4, 6, 2.8, 8, 3.2, 9.5, 4.2];
  const sort = ['match', ['get', 'best'], '3s', 6, '2s', 5, '1s', 4, 'bib', 3, 'green', 2, 1];   // best awards on top, all under saved pins
  return [
    { id: 'mich-dots', type: 'circle', source: 'michelin', 'source-layer': MICHELIN_SOURCE_LAYER, maxzoom: ZOOM.michelinPins + 0.8, ...(filter ? { filter } : {}),
      layout: { ...vis, 'circle-sort-key': sort },
      paint: { 'circle-color': colorBy, 'circle-radius': dotR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 9, 1.2],
               'circle-opacity': ['interpolate', ['linear'], ['zoom'], ZOOM.michelinPins, 1, ZOOM.michelinPins + 0.8, 0],
               'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], ZOOM.michelinPins, 1, ZOOM.michelinPins + 0.8, 0] } },
    { id: 'mich-pins', type: 'symbol', source: 'michelin', 'source-layer': MICHELIN_SOURCE_LAYER, minzoom: ZOOM.michelinPins, ...(filter ? { filter } : {}),
      layout: { ...vis, 'icon-image': iconBy, 'icon-size': ['interpolate', ['linear'], ['zoom'], 9.5, 0.5, 12, 0.7, 14, 0.88, 17, 1.05], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': sort },
      paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], ZOOM.michelinPins, 0, ZOOM.michelinPins + 0.8, 1] } },
    { id: 'mich-names', type: 'symbol', source: 'michelin', 'source-layer': MICHELIN_SOURCE_LAYER, minzoom: ZOOM.labels, ...(filter ? { filter } : {}),
      layout: { ...vis, 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-max-width': 8, 'text-optional': true },
      paint: { 'text-color': '#7c3a07', 'text-halo-color': '#ffffff', 'text-halo-width': 1.7 } },
  ];
};
export const michelinBadgeLayer = () => [
  { id: 'mich-badge', type: 'symbol', source: 'places', minzoom: ZOOM.michelinBadge, filter: ['==', ['get', 'mich'], true],
    layout: { 'icon-image': 'mich-badge', 'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.8, 17, 1], 'icon-offset': [-14, -14], 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
];
export const setMichelinVisible = (map, on) => ['mich-dots', 'mich-pins', 'mich-names'].forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
export const setMichelinFilter = (map, f) => ['mich-dots', 'mich-pins', 'mich-names'].forEach((id) => map.getLayer(id) && map.setFilter(id, f));
const AWARD_GLYPH = '<circle cx="12" cy="9.5" r="5.2"/><path d="M8.6 13.6L7 21l5-2.6 5 2.6-1.6-7.4"/>';   // rosette with ribbons, same as icons.svg #u-award
export const michelinPinSVG = (color) => `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="33" r="29" fill="rgba(0,0,0,.3)"/><circle cx="32" cy="32" r="28.5" fill="#fff"/><circle cx="32" cy="32" r="24.5" fill="rgba(255,252,250,.96)" stroke="${color}" stroke-width="4"/><g transform="translate(15.5 15.5) scale(1.35)" fill="none" stroke="${color}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${AWARD_GLYPH}</g></svg>`;
export const michelinBadgeSVG = () => `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="21" r="18" fill="rgba(0,0,0,.25)"/><circle cx="20" cy="20" r="17" fill="#fff"/><circle cx="20" cy="20" r="13" fill="${MICHELIN_COLOR}"/><g transform="translate(8.5 8.5) scale(.96)" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${AWARD_GLYPH}</g></svg>`;
export async function loadMichelinImages() {
  const o = { 'mich-badge': await svgToImageData(michelinBadgeSVG(), 40) };
  for (const k of ['star', 'bib', 'green', 'sel']) o['mich-' + k] = await svgToImageData(michelinPinSVG(AWARD[k].color), 64);
  return o;
}

/* ---------- Locate me: accuracy halo + pulse ----------
   Position never leaves the browser: only the map and the list distance use it, nothing is sent or stored.
   Accuracy halo in metres -> pixels: radius = metres / (156543.03 * cos(lat) / 2^zoom); an exponential interpolate on zoom stays GPU-side. */
export const userAccuracyRadius = (metres, lat) => { const k = (z) => metres / (156543.03 * Math.cos(lat * Math.PI / 180) / Math.pow(2, z)); return ['interpolate', ['exponential', 2], ['zoom'], 8, k(8), 20, k(20)]; };
export function setUser(map, lng, lat, acc = 60) {
  map.getSource('user').setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }] });
  map.setPaintProperty('user-acc', 'circle-radius', userAccuracyRadius(acc, lat));
}
export function clearUser(map) { map.getSource('user').setData({ type: 'FeatureCollection', features: [] }); }
export function pulseUser(map, reduced = false) {            // 1.6 s ease-out ring, loops until cancelled; returns cancel()
  if (reduced) return () => {};
  let raf, t0 = performance.now(); const tick = (t) => { const k = ((t - t0) % 1600) / 1600; map.getLayer('user-pulse') && (map.setPaintProperty('user-pulse', 'circle-radius', 8 + 16 * k), map.setPaintProperty('user-pulse', 'circle-opacity', 0.4 * (1 - k))); raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
}
/* Temporary search pin (area or address result): one maplibregl.Marker with an outlined teardrop in the ink colour, never a place pin.
   Dismissed by its chip "x" or by choosing another result. Search is first-party: built-in index (saved places, Michelin names, gazetteer of cities, neighbourhoods, ZIPs from GeoNames)
   plus addresses from the owner\u0027s own geocoder; no third-party service. When the address geocoder is down the Addresses group shows
   "Address search is offline right now" and places and areas keep working. */
export const SEARCH_PIN_SVG = (ink) => `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42"><path d="M17 40S4 28.500 4 16.500a13 13 0 0 1 26 0C30 28.500 17 40 17 40z" fill="#fff" fill-opacity=".92" stroke="${ink}" stroke-width="3"/><circle cx="17" cy="16.500" r="4.500" fill="none" stroke="${ink}" stroke-width="3"/></svg>`;
export const GEOCODER_ATTRIBUTION = '\u00a9 OpenStreetMap contributors \u00b7 GeoNames';   // footer under results; drop it if it crowds (attribution then lives in the map credit)
