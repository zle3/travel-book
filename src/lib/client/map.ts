/** The map: MapLibre GL, Protomaps basemap (home backend) over a static low-zoom world overview, saved places and the Michelin layer as GPU layers.
 * No clustering, no DOM markers. Loaded by dynamic import right after the shell paints. */
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { ATTRIBUTION, AWARD, FLAVOR, creditText, hoodLayers, PALETTE, ZOOM, clearUser, loadMichelinImages, loadPinImages, michelinBadgeLayer, michelinLayers, pinLayers, pulseUser, registerPinImages, setUser, SEARCH_PIN_SVG } from "../../assets/design/map-config.js";
import { LOW_MAX_ZOOM, tilesForBounds } from "../data/michelin";
import type { Config, Place, View } from "./store";
import { reducedMotion } from "./store";

export const API_BASE = (import.meta.env.PUBLIC_API_BASE as string | undefined) ?? "https://api.travel.zachle.info";
export const TILESET = (import.meta.env.PUBLIC_TILESET as string | undefined) ?? "basemap-v20261124";
const HOME_MIN_ZOOM = 6;
const NOAA = "https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows?service=WMS&version=1.3.0&request=GetMap&layers=conus_bref_qcd&styles=&format=image/png&transparent=true&width=256&height=256&crs=EPSG:3857&bbox={bbox-epsg-3857}";
const FONT = (s: string) => s.split('"Noto Sans Regular"').join('"noto-regular"');
const DESIGN_BEST: Record<string, string> = { S1: "1s", S2: "2s", S3: "3s", B: "bib", G: "green", L: "sel" };

export interface MichelinPoint { id: string; name: string; x: number; y: number; best: string; yr: number }
export interface MapEvents {
  onMove(v: View, bounds: [number, number, number, number]): void;
  onPlace(id: string): void;
  onMichelin(p: MichelinPoint): void;
  /** A tap on a neighborhood outline or fill (only while the San Francisco layer is shown). */
  onHood(slug: string): void;
  onBackground(): void;
  onHomeFailing(): void;
  onReady(): void;
  /** A visitor pan, zoom or pinch (not a programmatic fly-to). */
  onUserMove(): void;
}
export interface MapController {
  map: maplibregl.Map;
  setPlaces(list: Place[], hearted: Set<string>): void;
  /** Show the neighborhood layer with this data, or hide it (null). */
  setHoods(hoods: GeoJSON.FeatureCollection | null, labels?: GeoJSON.FeatureCollection): void;
  /** Highlight one neighborhood (null clears). */
  setHood(slug: string | null): void;
  setMichelin(on: boolean, bests: string[], currentOnly: boolean, edition: number): void;
  flyTo(lng: number, lat: number, zoom: number, pad?: Pad): void;
  fitBounds(b: [number, number, number, number], pad?: Pad): void;
  setUser(lng: number, lat: number, acc: number): () => void;
  clearUser(): void;
  setSearchPin(lng: number, lat: number): void;
  clearSearchPin(): void;
  setTheme(t: "light" | "dark"): void;
  setRadar(on: boolean): void;
  setHome(on: boolean): void;
  select(id: string | null): void;
  resize(): void;
  view(): View;
  bounds(): [number, number, number, number];
  setPad(p: Pad): void;
}
export interface Pad { top?: number; bottom?: number; left?: number; right?: number }

const hexOf = (cfg: Config) => { const g: Record<string, string> = {}; for (const x of cfg.categories.groups) g[x.id] = x.hex; g.other = cfg.categories.uncategorized.hex; return g; };

export async function createMap(el: HTMLElement, cfg: Config, start: View, theme: "light" | "dark", ev: MapEvents): Promise<MapController> {
  const groupHex = hexOf(cfg);
  const catGroup: Record<string, { group: string }> = {};
  for (const c of cfg.categories.categories) catGroup[c.id] = { group: c.group };
  catGroup.other = { group: "other" };

  let placesFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  let michFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  let hoodsFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] }, hoodLabelsFC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  let hoodsOn = false, selHood = "";
  let michOn = false, michFilter: unknown = null, radarOn = false, homeOn = true, curTheme = theme;
  /** The credit line under the map lists only the sources that are showing (the licence duty for OpenStreetMap data). */
  const writeCredit = () => { const c = document.getElementById("credit"); if (c) c.textContent = creditText({ michelin: michOn, radar: radarOn, hoods: hoodsOn }); };
  writeCredit();
  const homeLayers: Record<string, unknown[]> = {};
  const loadHome = async (t: "light" | "dark") => homeLayers[t] ?? (homeLayers[t] = await fetch(`/style/home-${t}.json`).then((r) => r.json()).catch(() => []));
  const images: Record<string, ImageData | null> = {};

  async function style(t: "light" | "dark"): Promise<maplibregl.StyleSpecification> {
    const pal = PALETTE[t], fl = FLAVOR[t];
    const home = (await loadHome(t)) as { layout?: Record<string, unknown> }[];
    const layers = [
      { id: "w-bg", type: "background", paint: { "background-color": pal.water } },
      { id: "w-land", type: "fill", source: "world-land", paint: { "fill-color": fl.earth } },
      { id: "w-cities", type: "symbol", source: "world-cities", maxzoom: 8, layout: { "text-field": ["get", "name"], "text-font": ["noto-regular"], "text-size": 11, "text-optional": true, "text-max-width": 8, "symbol-sort-key": ["get", "r"] }, paint: { "text-color": pal.text, "text-halo-color": pal.halo, "text-halo-width": 1.4 } },
      ...home.map((l) => (homeOn ? l : { ...l, layout: { ...(l.layout ?? {}), visibility: "none" } })),
      ...hoodLayers({ theme: t, on: hoodsOn, sel: selHood }),
      ...michelinLayers(michOn, michFilter).map((l: Record<string, unknown>) => { const { ["source-layer"]: _s, ...rest } = l; return rest; }),
      ...pinLayers({ theme: t, hasGlyphs: true }),
      ...michelinBadgeLayer(),
      ...(radarOn ? [{ id: "radar", type: "raster", source: "radar", paint: { "raster-opacity": 0.6 } }] : []),
    ];
    return JSON.parse(FONT(JSON.stringify({
      version: 8, glyphs: "/glyphs/{fontstack}/{range}.pbf",
      sources: {
        "world-land": { type: "geojson", data: "/basemap/land.json" },
        "world-cities": { type: "geojson", data: "/basemap/cities.json" },
        "base-home": { type: "vector", tiles: [`${API_BASE}/v1/tiles/${TILESET}/{z}/{x}/{y}.mvt`], minzoom: HOME_MIN_ZOOM, maxzoom: 15, attribution: ATTRIBUTION.standard },
        hoods: { type: "geojson", data: hoodsFC },
        "hood-labels": { type: "geojson", data: hoodLabelsFC },
        places: { type: "geojson", data: placesFC },
        michelin: { type: "geojson", data: michFC },
        user: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
        ...(radarOn ? { radar: { type: "raster", tiles: [NOAA], tileSize: 256, attribution: ATTRIBUTION.radar } } : {}),
      },
      layers,
    })));
  }

  const map = new maplibregl.Map({
    container: el, style: await style(theme), center: [start.lng, start.lat], zoom: start.zoom, minZoom: 1.2, maxZoom: 19.5,
    attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false, fadeDuration: reducedMotion() ? 0 : 200,
  });
  map.touchZoomRotate.disableRotation();
  let pad: Pad = {};
  const root = el.closest("#app") ?? el;

  // Pin images: rasterised once from the inline sprite so the map and the UI never drift.
  const glyphs: Record<string, string> = {};
  for (const id of Object.keys(catGroup)) glyphs[id] = document.getElementById(`c-${id}`)?.innerHTML ?? "";
  const heartPath = document.querySelector("#u-heart path")?.getAttribute("d") ?? "";
  Object.assign(images, await loadPinImages({ categories: catGroup, glyphs, groupColors: groupHex, heartPath }), await loadMichelinImages());
  const addImages = () => registerPinImages(map, images);
  map.on("styleimagemissing", (e) => { const im = images[e.id]; if (im && !map.hasImage(e.id)) map.addImage(e.id, im, { pixelRatio: 2 }); });
  let selId: string | null = null;
  const reselect = () => { const f = selId ? ["==", ["get", "id"], selId] : ["==", ["get", "id"], -1]; for (const l of ["sel-halo", "pins-sel"]) if (map.getLayer(l)) map.setFilter(l, f as never); };
  map.on("style.load", () => { addImages(); reselect(); });
  map.on("load", () => { addImages(); ev.onReady(); });

  const bounds = (): [number, number, number, number] => { const b = map.getBounds(); return [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; };
  const view = (): View => { const c = map.getCenter(); return { lng: c.lng, lat: c.lat, zoom: map.getZoom() }; };
  const padding = (): maplibregl.PaddingOptions => ({ top: pad.top ?? 0, bottom: pad.bottom ?? 0, left: pad.left ?? 0, right: pad.right ?? 0 });

  // Michelin data: low.json below LOW_MAX_ZOOM, the z5 grid tiles above; loaded only while the layer is on.
  let low: GeoJSON.Feature[] | null = null;
  const tiles = new Map<string, GeoJSON.Feature[]>();
  const inflight = new Set<string>();
  const feat = (id: string, x: number, y: number, best: string, yr: number, name: string): GeoJSON.Feature => ({ type: "Feature", properties: { id, best: DESIGN_BEST[best] ?? "sel", yr, name }, geometry: { type: "Point", coordinates: [x, y] } });
  let michSeq = 0;
  async function refreshMichelin(): Promise<void> {
    if (!michOn) return;
    const seq = ++michSeq;
    const src = map.getSource("michelin") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (map.getZoom() < LOW_MAX_ZOOM) {
      if (!low) { try { low = (await fetch("/michelin/low.json").then((r) => r.json()) as [number, number, string, number][]).map((r, i) => feat(`l${i}`, r[0], r[1], r[2], r[3], "")); } catch { return; } }
      if (seq === michSeq) { michFC = { type: "FeatureCollection", features: low }; src.setData(michFC); }
      return;
    }
    const need = tilesForBounds(bounds()).filter((k) => !tiles.has(k) && !inflight.has(k));
    await Promise.all(need.map(async (k) => {
      inflight.add(k);
      try {
        const rows = (await fetch(`/michelin/t/${k}.json`).then((r) => (r.ok ? r.json() : []))) as [string, number, number, string, number, string][];
        tiles.set(k, rows.map((r) => feat(r[0], r[1], r[2], r[3], r[4], r[5])));
      } catch { tiles.set(k, []); } finally { inflight.delete(k); }
    }));
    if (seq !== michSeq) return;
    const all: GeoJSON.Feature[] = [];
    for (const k of tilesForBounds(bounds())) all.push(...(tiles.get(k) ?? []));
    michFC = { type: "FeatureCollection", features: all };
    src.setData(michFC);
  }

  map.on("movestart", (e) => { if ((e as { originalEvent?: unknown }).originalEvent) ev.onUserMove(); });
  let moveT = 0;
  map.on("moveend", () => { window.clearTimeout(moveT); moveT = window.setTimeout(() => { ev.onMove(view(), bounds()); void refreshMichelin(); }, 120); });

  // Selection by tap or click.
  const hitLayers = ["pins", "dots", "mich-pins", "mich-dots"];
  map.on("click", (e) => {
    const r = 12;
    const f = map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: hitLayers.filter((l) => map.getLayer(l)) });
    const place = f.find((x) => x.layer.id === "pins" || x.layer.id === "dots");
    const mich = f.find((x) => x.layer.id.startsWith("mich-"));
    if (place) ev.onPlace(String(place.properties!.id));
    else if (mich) { const p = mich.properties!; const c = (mich.geometry as GeoJSON.Point).coordinates; ev.onMichelin({ id: String(p.id), name: String(p.name ?? ""), x: c[0]!, y: c[1]!, best: String(p.best), yr: Number(p.yr) }); }
    else {
      const hood = hoodsOn && map.getLayer("hoods-fill") ? map.queryRenderedFeatures(e.point, { layers: ["hoods-fill"] })[0] : undefined;
      if (hood) ev.onHood(String(hood.properties!.slug)); else ev.onBackground();
    }
  });
  map.on("mousemove", (e) => { const f = map.queryRenderedFeatures(e.point, { layers: hitLayers.filter((l) => map.getLayer(l)) }); map.getCanvas().style.cursor = f.length ? "pointer" : ""; });

  // Home tile failures: three within 30 s mean offline. Missing tiles (404/204, outside the extract) are not failures.
  const fails: number[] = [];
  map.on("error", (e) => {
    const err = e.error as { status?: number } | undefined;
    if ((e as { sourceId?: string }).sourceId !== "base-home") return;
    if (err?.status && err.status < 500) return;
    const now = Date.now(); fails.push(now);
    while (fails.length && now - fails[0]! > 30000) fails.shift();
    if (fails.length >= 3) { fails.length = 0; ev.onHomeFailing(); }
  });

  let pin: maplibregl.Marker | null = null;
  const ro = new ResizeObserver(() => map.resize());
  ro.observe(root as Element);

  const apply = async (t: "light" | "dark") => { map.setStyle(await style(t), { diff: false }); };

  return {
    map,
    setPlaces(list, hearted) {
      placesFC = { type: "FeatureCollection", features: list.map((p) => ({ type: "Feature", properties: { id: p.id, n: p.n, cat: catGroup[p.c] ? p.c : "other", col: groupHex[catGroup[p.c]?.group ?? "other"], rank: hearted.has(p.id) ? 3 : p.s === "m" ? 2 : 1, been: !!p.been, mich: !!p.mich }, geometry: { type: "Point", coordinates: [p.x, p.y] } })) };
      (map.getSource("places") as maplibregl.GeoJSONSource | undefined)?.setData(placesFC);
    },
    setHoods(fc, labels) {
      hoodsOn = !!fc; writeCredit();
      if (fc) { hoodsFC = fc; hoodLabelsFC = labels ?? hoodLabelsFC; }
      (map.getSource("hoods") as maplibregl.GeoJSONSource | undefined)?.setData(hoodsFC);
      (map.getSource("hood-labels") as maplibregl.GeoJSONSource | undefined)?.setData(hoodLabelsFC);
      for (const id of ["hoods-fill", "hoods-line", "hoods-sel", "hoods-label"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", hoodsOn ? "visible" : "none");
    },
    setHood(slug) {
      selHood = slug ?? "";
      if (map.getLayer("hoods-fill")) map.setPaintProperty("hoods-fill", "fill-opacity", hoodLayers({ theme: curTheme, sel: selHood })[0].paint["fill-opacity"]);
      if (map.getLayer("hoods-sel")) map.setFilter("hoods-sel", ["==", ["get", "slug"], selHood]);
    },
    setMichelin(on, bests, currentOnly, edition) {
      michOn = on; writeCredit();
      const f: unknown[] = ["all"];
      const codes = bests.flatMap((k) => (k === "star" ? ["1s", "2s", "3s"] : [k]));
      if (codes.length) f.push(["in", ["get", "best"], ["literal", codes]]);
      if (currentOnly) f.push([">=", ["get", "yr"], edition]);
      michFilter = f.length > 1 ? f : null;
      for (const id of ["mich-dots", "mich-pins", "mich-names"]) if (map.getLayer(id)) { map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); map.setFilter(id, michFilter as never); }
      if (on) void refreshMichelin();
    },
    flyTo(lng, lat, zoom, p) {
      const o = { center: [lng, lat] as [number, number], zoom, padding: p ? { top: p.top ?? 0, bottom: p.bottom ?? 0, left: p.left ?? 0, right: p.right ?? 0 } : padding(), essential: false };
      if (reducedMotion()) map.jumpTo(o); else map.easeTo({ ...o, duration: 650 });
    },
    fitBounds(b, p) { map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: p ? { top: (p.top ?? 0) + 40, bottom: (p.bottom ?? 0) + 40, left: (p.left ?? 0) + 40, right: (p.right ?? 0) + 40 } : 60, maxZoom: 15, duration: reducedMotion() ? 0 : 650 }); },
    setUser(lng, lat, acc) { setUser(map, lng, lat, acc); return pulseUser(map, reducedMotion()); },
    clearUser() { clearUser(map); },
    setSearchPin(lng, lat) {
      pin?.remove();
      const d = document.createElement("div"); d.className = "spin-m"; d.innerHTML = SEARCH_PIN_SVG(getComputedStyle(document.documentElement).getPropertyValue("--map-sel").trim() || "#6c495b");
      pin = new maplibregl.Marker({ element: d, anchor: "bottom" }).setLngLat([lng, lat]).addTo(map);
    },
    clearSearchPin() { pin?.remove(); pin = null; },
    setTheme(t) { curTheme = t; void apply(t); },
    setRadar(on) { radarOn = on; writeCredit(); void apply(curTheme); },
    setHome(on) { homeOn = on; for (const l of (homeLayers[curTheme] ?? []) as { id: string }[]) if (map.getLayer(l.id)) map.setLayoutProperty(l.id, "visibility", on ? "visible" : "none"); },
    select(id) { selId = id; reselect(); },
    resize() { map.resize(); },
    view, bounds,
    setPad(p) { pad = p; },
  };
}
export { ZOOM, AWARD };
