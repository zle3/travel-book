/** Covered metros: used by the gazetteer trim, the region filter and the first-visit default. [west, south, east, north] */
export interface Metro { id: string; name: string; bbox: [number, number, number, number]; center: [number, number] }
export const METROS: Metro[] = [
  { id: "sf", name: "Bay Area", bbox: [-123.1, 36.9, -121.5, 38.6], center: [-122.4194, 37.7749] },
  { id: "sac", name: "Sacramento", bbox: [-121.9, 38.2, -120.9, 39.0], center: [-121.4944, 38.5816] },
  { id: "sea", name: "Seattle", bbox: [-122.8, 47.0, -121.9, 48.0], center: [-122.3321, 47.6062] },
  { id: "nyc", name: "New York", bbox: [-74.3, 40.4, -73.6, 41.0], center: [-74.006, 40.7128] },
];
export const inBBox = (lng: number, lat: number, b: readonly number[]): boolean => lng >= b[0]! && lng <= b[2]! && lat >= b[1]! && lat <= b[3]!;
/** Metro id for a point, or "other". Bay Area wins over Sacramento where the boxes touch. */
export function metroOf(lng: number, lat: number): string {
  for (const m of METROS) if (inBBox(lng, lat, m.bbox)) return m.id;
  return "other";
}
