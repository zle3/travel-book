/** Small pure geo and text helpers shared by the build scripts, the worker and the browser. */
const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
/** Great-circle distance in metres. */
export function distanceM(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** Accent-folded, lowercased, punctuation-light key used for matching and search. */
export function fold(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
/** Distance as short text: feet under 0.1 mi, then miles. */
export function fmtDistance(m: number): string {
  const mi = m / 1609.344;
  if (mi < 0.1) return `${Math.max(50, Math.round((m * 3.28084) / 50) * 50)} ft`;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}
export const round = (n: number, d: number): number => { const k = 10 ** d; return Math.round(n * k) / k; };
