import { test } from "node:test";
import assert from "node:assert/strict";
import { dayLabel, filterShows, groupByDate, rangeOf, regionFor, ymd } from "../../../src/lib/shows.ts";

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
