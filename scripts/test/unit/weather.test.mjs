import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptNwsAlerts, adaptOpenMeteo, defaultUnits, describe, fmtClock, fmtHour, openMeteoUrl, roundCoord } from "../../../src/lib/weather.ts";

const om = {
  timezone: "America/Los_Angeles",
  current: { time: "2026-11-24T15:30", temperature_2m: 58.4, apparent_temperature: 56.2, relative_humidity_2m: 70, weather_code: 2, wind_speed_10m: 7.6, is_day: 1 },
  hourly: { time: ["2026-11-24T13:00", "2026-11-24T15:00", "2026-11-24T16:00", "2026-11-25T00:00"], temperature_2m: [57, 58, 55, 50], weather_code: [1, 2, 61, 3], precipitation_probability: [0, 10, 60, 5], is_day: [1, 1, 1, 0] },
  daily: { time: ["2026-11-24", "2026-11-25"], weather_code: [2, 95], temperature_2m_max: [60.2, 55], temperature_2m_min: [48.1, 47], precipitation_probability_max: [10, 80], sunrise: ["2026-11-24T06:59", "2026-11-25T07:00"], sunset: ["2026-11-24T16:55", "2026-11-25T16:54"] },
};
test("Open-Meteo payload becomes now, the rest of today by hour, and 7-day days", () => {
  const w = adaptOpenMeteo(om, "f", "T");
  assert.deepEqual(w.now, { temp: 58, feels: 56, humidity: 70, wind: 8, code: 2, isDay: true, label: "Partly cloudy", icon: "w-partly-day" });
  assert.deepEqual(w.hours.map((h) => h.t), ["2026-11-24T15:00", "2026-11-24T16:00"]);
  assert.equal(w.hours[1].icon, "w-rain");
  assert.equal(w.days[1].label, "Thunderstorm");
  assert.equal(w.days[0].sunset, "2026-11-24T16:55");
  assert.equal(w.units, "f"); assert.equal(w.tz, "America/Los_Angeles");
});
test("a payload it cannot read throws instead of showing nonsense", () => {
  assert.throws(() => adaptOpenMeteo({}, "f"));
  assert.throws(() => adaptOpenMeteo({ current: {}, hourly: {}, daily: {} }, "f"));
});
test("coordinates are rounded to 2 decimals before any request", () => {
  assert.equal(roundCoord(37.774929), 37.77);
  assert.equal(roundCoord(-122.419416), -122.42);
  const u = new URL(openMeteoUrl(37.774929, -122.419416, "f"));
  assert.equal(u.searchParams.get("latitude"), "37.77");
  assert.equal(u.searchParams.get("longitude"), "-122.42");
  assert.equal(u.searchParams.get("temperature_unit"), "fahrenheit");
  assert.equal(new URL(openMeteoUrl(35.68, 139.69, "c")).searchParams.get("wind_speed_unit"), "kmh");
});
test("units: Fahrenheit in the US including Alaska and Hawaii, Celsius elsewhere", () => {
  assert.equal(defaultUnits(-122.4, 37.8), "f");
  assert.equal(defaultUnits(-149.9, 61.2), "f");
  assert.equal(defaultUnits(-157.8, 21.3), "f");
  assert.equal(defaultUnits(139.7, 35.7), "c");
  assert.equal(defaultUnits(-0.1, 51.5), "c");
});
test("weather codes map to labels and day or night icons", () => {
  assert.deepEqual(describe(0, true), { label: "Clear", icon: "w-clear-day" });
  assert.equal(describe(0, false).icon, "w-clear-night");
  assert.equal(describe(45).icon, "w-fog"); assert.equal(describe(73).icon, "w-snow"); assert.equal(describe(99).icon, "w-storm"); assert.equal(describe(999).icon, "w-storm");
});
test("NWS alerts are ranked by severity, trimmed and tolerant of junk", () => {
  const a = adaptNwsAlerts({ features: [{ properties: { id: "1", event: "Wind Advisory", severity: "Minor", headline: "h1" } }, { properties: { id: "2", event: "Flood Warning", severity: "Severe", headline: "h2", areaDesc: "X" } }, { properties: {} }, null] });
  assert.deepEqual(a.map((x) => x.event), ["Flood Warning", "Wind Advisory"]);
  assert.deepEqual(adaptNwsAlerts(null), []);
  assert.equal(adaptNwsAlerts({ features: Array.from({ length: 9 }, (_, i) => ({ properties: { event: `e${i}` } })) }).length, 5);
});
test("clock helpers", () => { assert.equal(fmtClock("2026-11-24T16:55"), "4:55 PM"); assert.equal(fmtClock("2026-11-24T00:05"), "12:05 AM"); assert.equal(fmtHour("2026-11-24T15:00"), "3p"); assert.equal(fmtHour("2026-11-24T00:00"), "12a"); });
