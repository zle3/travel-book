import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAreaIndex, buildPlaceIndex, searchAreas, searchMichelin, searchPlaces, withinOneEdit } from "../../../src/lib/search.ts";

const places = buildPlaceIndex([
  { id: "1", n: "Rintaro", c: "sit-down-restaurants", s: "m", x: 0, y: 0 },
  { id: "2", n: "Café Rintaro Two", c: "bakery", s: "o", x: 0, y: 0 },
  { id: "3", n: "Tartine Bakery & Café", c: "bakery", s: "m", x: 0, y: 0 },
  { id: "4", n: "The Buoy", c: "tea-drinks", s: "o", x: 0, y: 0 },
]);
test("places: accent-insensitive prefix, word prefix, then substring", () => {
  assert.deepEqual(searchPlaces(places, "rint").map((h) => h.id), ["1", "2"]);
  assert.deepEqual(searchPlaces(places, "cafe").map((h) => h.id), ["2", "3"]);
  assert.deepEqual(searchPlaces(places, "tartine and caf").map((h) => h.id), ["3"]);
  assert.deepEqual(searchPlaces(places, "uoy").map((h) => h.id), ["4"]);
  assert.deepEqual(searchPlaces(places, "zzz"), []);
});
const areas = buildAreaIndex([
  ["San Francisco", "city", 37.77, -122.41, "sf", 800000],
  ["Mission District", "hood", 37.76, -122.42, "sf", 0],
  ["Sacramento", "city", 38.58, -121.49, "sac", 500000],
  ["94110", "zip", 37.75, -122.41, "sf", 0],
  ["94103", "zip", 37.77, -122.41, "sf", 0],
]);
test("areas: city by prefix, neighborhood, ZIP only for digits", () => {
  assert.equal(searchAreas(areas, "san fran")[0].name, "San Francisco");
  assert.equal(searchAreas(areas, "mission")[0].area, "hood");
  assert.deepEqual(searchAreas(areas, "9411").map((h) => h.name), ["94110"]);
  assert.deepEqual(searchAreas(areas, "san").every((h) => h.area !== "zip"), true);
});
test("areas: one typo is tolerated on words of 4+ characters", () => {
  assert.equal(searchAreas(areas, "sacramnto")[0]?.name, "Sacramento");
  assert.equal(searchAreas(areas, "mision")[0]?.name, "Mission District");
  assert.equal(withinOneEdit("abc", "xyz"), false);
  assert.equal(withinOneEdit("abcd", "abdc"), false);
  assert.equal(searchAreas(areas, "qqqq").length, 0);
});
test("michelin shard rows match by word prefix and dedupe by id", () => {
  const rows = [["a1", "Frasca Food and Wine", 1, 2, "S1", "Boulder"], ["a1", "Frasca Food and Wine", 1, 2, "S1", "Boulder"], ["b2", "Le Frascati", 1, 2, "L", "Paris"], ["c3", "Zuni", 1, 2, "B", "SF"]];
  assert.deepEqual(searchMichelin(rows, "frasc").map((h) => h.id), ["a1", "b2"]);
  assert.equal(searchMichelin(rows, "wine")[0].id, "a1");
  assert.equal(searchMichelin(rows, "zuni")[0].sub, "SF");
});
