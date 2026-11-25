/** Weather: a small chip on the map for the map centre, and a sheet with now, today by hour, 7 days, sunrise and sunset.
 * Only the rounded map centre (2 decimals) is sent, through the Worker, never the visitor's own position. */
import { defaultUnits, fmtClock, fmtHour, fmtTemp, roundCoord } from "../weather";
import type { Weather, WeatherAlert } from "../weather";
import type { App } from "./app";
import { $, esc, icon } from "./store";

const FRESH_MS = 15 * 60 * 1000;

export function initWeather(app: App): void {
  const chip = $<HTMLButtonElement>("#wxchip");
  let wx: Weather | null = null, alerts: WeatherAlert[] = [], at = 0, lastLat = 999, lastLng = 999, timer = 0, radar = false, failed = false;

  const unitsFor = (lng: number, lat: number) => defaultUnits(lng, lat);

  async function pull(): Promise<void> {
    const lat = roundCoord(app.view.lat), lng = roundCoord(app.view.lng);
    if (app.view.zoom < 3) return;
    if (wx && Date.now() - at < FRESH_MS && Math.abs(lat - lastLat) < 0.1 && Math.abs(lng - lastLng) < 0.1) return;
    const units = unitsFor(lng, lat);
    try {
      const r = await fetch(`/api/weather?lat=${lat}&lng=${lng}&units=${units}`);
      if (!r.ok) throw new Error(String(r.status));
      wx = ((await r.json()) as { weather: Weather }).weather;
      at = Date.now(); lastLat = lat; lastLng = lng; failed = false;
      alerts = [];
      if (units === "f") fetch(`/api/alerts?lat=${lat}&lng=${lng}`).then((a) => (a.ok ? a.json() : { alerts: [] })).then((j: { alerts: WeatherAlert[] }) => { alerts = j.alerts ?? []; paintChip(); if ($("#weatherSheet").classList.contains("on")) paintSheet(); }).catch(() => {});
      paintChip();
    } catch { failed = true; if (!wx) chip.hidden = true; }
  }
  function paintChip(): void {
    if (!wx) return;
    chip.hidden = false;
    chip.innerHTML = `${icon(wx.now.icon)}<b>${fmtTemp(wx.now.temp)}</b>${alerts.length ? '<i class="dot" aria-hidden="true"></i>' : ""}`;
    chip.setAttribute("aria-label", `Weather near the middle of the map: ${wx.now.temp} degrees, ${wx.now.label}${alerts.length ? `, ${alerts.length} active alert${alerts.length > 1 ? "s" : ""}` : ""}. Open details.`);
  }
  function paintSheet(): void {
    const host = $("#weatherHost");
    if (!wx) { host.innerHTML = `<div class="shead2"><h2>Weather</h2><button class="ibtn" data-act="closeSheet" aria-label="Close" type="button">${icon("u-close")}</button></div><div class="empty"><b>${failed ? "Weather is unavailable right now." : "Loading weather…"}</b></div>`; return; }
    const u = wx.units === "f" ? "°F" : "°C", sp = wx.units === "f" ? "mph" : "km/h";
    const today = wx.days[0];
    const hourly = wx.hours.length ? `<h3>Today, hour by hour</h3><div class="hours" role="list">${wx.hours.map((h) => `<div class="hr" role="listitem"><span>${fmtHour(h.t)}</span>${icon(h.icon)}<b>${fmtTemp(h.temp)}</b>${h.pop >= 20 ? `<small>${h.pop}%</small>` : "<small>&nbsp;</small>"}</div>`).join("")}</div>` : "";
    const al = alerts.length ? `<div class="alerts" role="region" aria-label="Weather alerts">${alerts.map((a) => `<div class="alert"><b>${esc(a.event)}</b><span>${esc(a.headline)}</span></div>`).join("")}<p class="hint">Alerts from the US National Weather Service.</p></div>` : "";
    const days = `<h3>Next 7 days</h3><ul class="days">${wx.days.map((d, i) => `<li><span class="dn">${i === 0 ? "Today" : new Date(`${d.date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" })}</span>${icon(d.icon)}<span class="dl">${esc(d.label)}${d.pop >= 20 ? ` <small>${d.pop}% rain</small>` : ""}</span><b>${d.hi}${u === "°F" ? "°" : "°"}</b><span class="lo">${d.lo}°</span></li>`).join("")}</ul>`;
    const us = wx.units === "f";
    host.innerHTML = `<div class="shead2"><h2>Weather</h2><button class="ibtn" data-act="closeSheet" aria-label="Close" type="button">${icon("u-close")}</button></div>
<div class="fbody wxbody"><div class="wxnow">${icon(wx.now.icon, "big")}<div><div class="t">${wx.now.temp}${u}</div><p>${esc(wx.now.label)}. Feels like ${wx.now.feels}°. Humidity ${wx.now.humidity}%. Wind ${wx.now.wind} ${sp}.</p></div></div>
<p class="hint">For the middle of the map, rounded to about 1 km.</p>${al}${hourly}${days}
${today ? `<div class="sun"><span>${icon("w-sunrise")}Sunrise ${fmtClock(today.sunrise)}</span><span>${icon("w-sunset")}Sunset ${fmtClock(today.sunset)}</span></div>` : ""}
<h3>Rain radar</h3><label class="sw"><span class="nm">Show rain radar on the map<small class="hint2">${us ? "NOAA radar, United States only. Off by default." : "Radar covers the United States only."}</small></span><input type="checkbox" id="radarSw" ${radar ? "checked" : ""} ${us ? "" : "disabled"} /><span class="tg"></span></label>
<p class="credit-l">Forecast: <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>. Alerts and radar: NOAA National Weather Service.</p></div>`;
  }

  document.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-act=weather]")) { paintSheet(); void pull().then(() => { if ($("#weatherSheet").classList.contains("on")) paintSheet(); }); } }, true);
  document.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "radarSw") { radar = t.checked; app.ctl?.setRadar(radar); }
  });
  const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void pull(), 1500); };
  window.addEventListener("tb:move", schedule);
  window.addEventListener("tb:map", schedule);
  schedule();
}
