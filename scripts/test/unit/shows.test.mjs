import { test } from "node:test";
import assert from "node:assert/strict";
import { alertBody, dayLabel, filterShows, formatShowLine, groupByDate, parseShowWhen, rangeOf, regionFor, safeMoreUrl, untilLabel, ymd } from "../../../src/lib/shows.ts";

const now = new Date(2026, 10, 25, 10);               // Wed Nov 25 2026, local
const ev = (id, date, title, extra = {}) => ({ id, date, title, venue: "Venue", city: "SF", tags: ["house"], orgs: "", ...extra });
const list = [ev("1", "2026-11-24", "Yesterday"), ev("2", "2026-11-25", "Tonight"), ev("3", "2026-11-27", "Friday night"), ev("4", "2026-11-29", "Sunday"), ev("5", "2026-12-20", "Later", { tags: ["techno"] })];

test("ranges: today, this weekend (Fri to Sun), next 7 days, all upcoming; past is always hidden", () => {
  assert.deepEqual(rangeOf("today", now), ["2026-11-25", "2026-11-25"]);
  assert.deepEqual(rangeOf("weekend", now), ["2026-11-27", "2026-11-29"]);
  assert.deepEqual(rangeOf("week", now), ["2026-11-25", "2026-12-01"]);
  assert.deepEqual(filterShows(list, { range: "all", now }).map((e) => e.id), ["2", "3", "4", "5"]);
  assert.deepEqual(filterShows(list, { range: "weekend", now }).map((e) => e.id), ["3", "4"]);
  assert.deepEqual(filterShows(list, { range: "week", now }).map((e) => e.id), ["2", "3", "4"]);
});
test("on a Saturday the weekend starts today, not yesterday", () => {
  assert.deepEqual(rangeOf("weekend", new Date(2026, 10, 28, 12)), ["2026-11-28", "2026-11-29"]);
  assert.deepEqual(rangeOf("weekend", new Date(2026, 10, 29, 12)), ["2026-11-29", "2026-11-29"]);
});
test("search matches title, venue, genre and organisers, accent-insensitively", () => {
  assert.deepEqual(filterShows(list, { q: "techno", range: "all", now }).map((e) => e.id), ["5"]);
  assert.deepEqual(filterShows([ev("9", "2026-11-26", "Café night", { orgs: "Hex" })], { q: "cafe hex", range: "all", now }).length, 1);
});
test("grouping by day keeps order; labels say Today and Tomorrow", () => {
  const g = groupByDate(filterShows(list, { range: "all", now }));
  assert.deepEqual(g.map((x) => x.date), ["2026-11-25", "2026-11-27", "2026-11-29", "2026-12-20"]);
  assert.match(dayLabel("2026-11-25", now), /^Today, /); assert.match(dayLabel("2026-11-26", now), /^Tomorrow, /); assert.match(dayLabel("2026-12-20", now), /^Sun, Dec 20$/);
  assert.equal(ymd(now), "2026-11-25");
});
test("the show region follows the map", () => {
  assert.equal(regionFor(-122.4, 37.8), "bayarea"); assert.equal(regionFor(-122.3, 47.6), "seattle"); assert.equal(regionFor(-118.3, 34), "losangeles"); assert.equal(regionFor(-74, 40.7), "losangeles");
});


test("a row drops the date already in its day header, the weekday colon and the parentheses", () => {
  assert.equal(formatShowLine({ when: "Wed: Nov 25 (9pm-2am)", venue: "1015 Folsom", city: "San Francisco" }), "9pm–2am · 1015 Folsom, San Francisco");
  assert.equal(parseShowWhen("Wed: Nov 25 (9pm-2am)").span, "", "single-day rows carry no date");
});
test("multi-day entries keep their span in one compact label", () => {
  assert.equal(formatShowLine({ when: "Fri: Dec 4-Sat: Dec 5 (9pm)", venue: "Bottom of the Hill", city: "San Francisco" }), "Fri–Sat, Dec 4–5 · 9pm · Bottom of the Hill, San Francisco");
  assert.equal(parseShowWhen("Thu: Dec 31-Fri: Jan 1 (10pm)").span, "Dec 31–Jan 1");
});
test("a missing time or city leaves no stray separator and an empty row adds nothing", () => {
  assert.equal(formatShowLine({ when: "Wed: Nov 25", venue: "1015 Folsom", city: "San Francisco" }), "1015 Folsom, San Francisco");
  assert.equal(formatShowLine({ when: "Wed: Nov 25 (9pm)", venue: "1015 Folsom" }), "9pm · 1015 Folsom");
  assert.equal(formatShowLine({ when: "Wed: Nov 25 (9pm)", venue: "", city: "(Oakland)" }), "9pm · Oakland");
  assert.equal(formatShowLine({ when: undefined, venue: undefined, city: undefined }), "");
  assert.equal(formatShowLine({ when: "soon (", venue: "", city: "" }), "");
});
test("owner-added 24-hour times read as clock times; impossible ones are dropped", () => {
  assert.equal(formatShowLine({ when: "21:00", venue: "Hall", city: "Oakland" }), "9pm · Hall, Oakland");
  assert.equal(formatShowLine({ when: "21:30", venue: "Hall" }), "9:30pm · Hall");
  assert.equal(parseShowWhen("25:00").time, "");
});
test("weather alert cards: the until line is readable, the body drops the repeated title and the link must be https", () => {
  assert.equal(untilLabel("2026-11-26T18:00:00-08:00"), "until Nov 26, 6pm");
  assert.equal(untilLabel("2026-11-26T00:30:00-08:00"), "until Nov 26, 12:30am");
  assert.equal(untilLabel(""), "");
  assert.equal(untilLabel("2026-13-40T99:00"), "");
  const flood = { id: "f", event: "Coastal Flood Warning", severity: "Severe", headline: "Coastal Flood Warning issued November 25 at 2:03PM PST until November 26 at 6:00PM PST by NWS Eureka", ends: "", area: "" };
  assert.equal(alertBody(flood), "", "the headline only repeats the title and the time");
  assert.equal(alertBody({ ...flood, description: "Flooding is possible near the coast. Move to higher ground.\nMore text." }), "Flooding is possible near the coast.");
  assert.equal(safeMoreUrl("https://api.weather.gov/alerts/x"), "https://api.weather.gov/alerts/x");
  assert.equal(safeMoreUrl("javascript:alert(1)"), "");
  assert.equal(safeMoreUrl("http://example.com"), "");
});
