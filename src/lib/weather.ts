/** Weather model and adapters (pure): Open-Meteo forecast and NWS alerts to the small shapes the UI renders. Used by the Worker and the browser. */
export type Units = "f" | "c";
export interface WeatherNow { temp: number; feels: number; humidity: number; wind: number; code: number; isDay: boolean; label: string; icon: string }
export interface WeatherHour { t: string; temp: number; code: number; pop: number; icon: string }
export interface WeatherDay { date: string; hi: number; lo: number; code: number; pop: number; sunrise: string; sunset: string; label: string; icon: string }
export interface Weather { units: Units; tz: string; now: WeatherNow; hours: WeatherHour[]; days: WeatherDay[]; fetched: string }
export interface WeatherAlert { id: string; event: string; severity: string; headline: string; ends: string; area: string }

/** Coordinates leave the browser and reach the Worker rounded to 2 decimals (about 1 km). */
export const roundCoord = (n: number): number => Math.round(n * 100) / 100;
const US_BOX = [-125, 24, -66.5, 49.5] as const;
const AK_HI = [[-170, 51, -129, 72], [-161, 18, -154, 23]] as const;
/** Fahrenheit and mph inside the US, Celsius and km/h elsewhere. */
export function defaultUnits(lng: number, lat: number): Units {
  const inb = (b: readonly number[]) => lng >= b[0]! && lng <= b[2]! && lat >= b[1]! && lat <= b[3]!;
  return inb(US_BOX) || AK_HI.some(inb) ? "f" : "c";
}

/** WMO weather code to label and icon id (symbol in /icons.svg). */
export function describe(code: number, isDay = true): { label: string; icon: string } {
  if (code === 0) return { label: "Clear", icon: isDay ? "w-clear-day" : "w-clear-night" };
  if (code === 1) return { label: "Mostly clear", icon: isDay ? "w-partly-day" : "w-partly-night" };
  if (code === 2) return { label: "Partly cloudy", icon: isDay ? "w-partly-day" : "w-partly-night" };
  if (code === 3) return { label: "Cloudy", icon: "w-cloud" };
  if (code === 45 || code === 48) return { label: "Fog", icon: "w-fog" };
  if (code >= 51 && code <= 57) return { label: "Drizzle", icon: "w-drizzle" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label: code >= 80 ? "Showers" : "Rain", icon: "w-rain" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: "Snow", icon: "w-snow" };
  if (code >= 95) return { label: "Thunderstorm", icon: "w-storm" };
  return { label: "Cloudy", icon: "w-cloud" };
}

type Num = number | null | undefined;
const n = (v: Num, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

export const openMeteoUrl = (lat: number, lng: number, units: Units): string =>
  "https://api.open-meteo.com/v1/forecast?" + new URLSearchParams({
    latitude: String(roundCoord(lat)), longitude: String(roundCoord(lng)),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
    hourly: "temperature_2m,weather_code,precipitation_probability,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    temperature_unit: units === "f" ? "fahrenheit" : "celsius", wind_speed_unit: units === "f" ? "mph" : "kmh",
    timezone: "auto", forecast_days: "7",
  }).toString();

/** Open-Meteo response to our model. Hours: the rest of the local day from the current hour. Throws on a shape it cannot read. */
export function adaptOpenMeteo(j: any, units: Units, fetched = new Date().toISOString()): Weather {
  const c = j?.current, h = j?.hourly, d = j?.daily;
  if (!c || !Array.isArray(h?.time) || !Array.isArray(d?.time)) throw new Error("unexpected weather payload");
  const isDay = c.is_day === 1;
  const now: WeatherNow = { temp: Math.round(n(c.temperature_2m)), feels: Math.round(n(c.apparent_temperature)), humidity: Math.round(n(c.relative_humidity_2m)), wind: Math.round(n(c.wind_speed_10m)), code: n(c.weather_code), isDay, ...describe(n(c.weather_code), isDay) };
  const today = String(c.time ?? h.time[0]).slice(0, 10);
  const curHour = String(c.time ?? "").slice(0, 13);
  const hours: WeatherHour[] = [];
  h.time.forEach((t: string, i: number) => {
    if (t.slice(0, 10) !== today || t.slice(0, 13) < curHour) return;
    const code = n(h.weather_code?.[i]);
    hours.push({ t, temp: Math.round(n(h.temperature_2m?.[i])), code, pop: Math.round(n(h.precipitation_probability?.[i])), icon: describe(code, h.is_day?.[i] !== 0).icon });
  });
  const days: WeatherDay[] = d.time.map((date: string, i: number) => ({
    date, hi: Math.round(n(d.temperature_2m_max?.[i])), lo: Math.round(n(d.temperature_2m_min?.[i])), code: n(d.weather_code?.[i]), pop: Math.round(n(d.precipitation_probability_max?.[i])),
    sunrise: String(d.sunrise?.[i] ?? ""), sunset: String(d.sunset?.[i] ?? ""), ...describe(n(d.weather_code?.[i])),
  }));
  return { units, tz: String(j.timezone ?? ""), now, hours, days, fetched };
}

/** NWS /alerts/active GeoJSON to a short list, most severe first. Anything unreadable is dropped. */
export function adaptNwsAlerts(j: any): WeatherAlert[] {
  const rank: Record<string, number> = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1 };
  const feats: any[] = Array.isArray(j?.features) ? j.features : [];
  return feats.flatMap((f) => {
    const p = f?.properties;
    if (!p || typeof p.event !== "string") return [];
    return [{ id: String(p.id ?? p.event), event: p.event, severity: String(p.severity ?? "Unknown"), headline: String(p.headline ?? p.event).slice(0, 200), ends: String(p.ends ?? p.expires ?? ""), area: String(p.areaDesc ?? "").slice(0, 120) }];
  }).sort((a, b) => (rank[b.severity] ?? 0) - (rank[a.severity] ?? 0)).slice(0, 5);
}
export const fmtTemp = (t: number): string => `${t}°`;
export const fmtClock = (iso: string): string => { const m = /T(\d{2}):(\d{2})/.exec(iso); if (!m) return ""; const h = Number(m[1]); return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`; };
export const fmtHour = (iso: string): string => { const m = /T(\d{2})/.exec(iso); if (!m) return ""; const h = Number(m[1]); return `${h % 12 || 12}${h < 12 ? "a" : "p"}`; };
