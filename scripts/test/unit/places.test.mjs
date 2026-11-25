import { test } from "node:test";
import assert from "node:assert/strict";
import { MERGE_RADIUS_M, buildPlaces, slug } from "../../../src/lib/data/places.ts";
import { distanceM, fmtDistance, fold } from "../../../src/lib/data/geo.ts";

const cats = [{ id: "casual-food", label: "Casual Food", group: "food" }, { id: "parks", label: "Parks", group: "outdoors" }];
const P = (name, lat, lng, extra = {}) => ({ name, address: "1 Main St, Town, CA", lat, lng, note: "", maps: "", category: "Casual Food", ...extra });

test("same place on two lists merges: lists unioned, mine wins source and note", () => {
  const { places, lists } = buildPlaces([
    { name: "SF list", source: "other", places: [P("Café Rintaro", 37.7, -122.4, { note: "theirs" })] },
    { name: "Casual Food", source: "mine", places: [P("Cafe Rintaro", 37.70002, -122.40002, { note: "mine" })] },
  ], cats);
  assert.equal(places.length, 1);
  assert.deepEqual(places[0].l.sort(), ["casual-food", "sf-list"]);
  assert.equal(places[0].s, "m");
  assert.equal(places[0].note, "mine");
  assert.deepEqual(lists.map((l) => [l.id, l.count]), [["sf-list", 1], ["casual-food", 1]]);
});
test("same name farther than the merge radius stays two places", () => {
  assert.ok(distanceM(-122.4, 37.7, -122.4, 37.7007) > MERGE_RADIUS_M);
  const { places } = buildPlaces([{ name: "Casual Food", source: "mine", places: [P("Boba", 37.7, -122.4), P("Boba", 37.7007, -122.4)] }], cats);
  assert.equal(places.length, 2);
  assert.notEqual(places[0].id, places[1].id);
});
test("ids are stable across runs, unique, and safe for share links", () => {
  const input = [{ name: "Casual Food", source: "mine", places: [P("A", 1, 1, { maps: "https://maps.google.com/?cid=123" }), P("B", 2, 2)] }];
  const a = buildPlaces(input, cats).places, b = buildPlaces(input, cats).places;
  assert.deepEqual(a.map((p) => p.id), b.map((p) => p.id));
  for (const p of a) assert.match(p.id, /^[0-9a-z]{1,16}$/);
});
test("empty addresses are fine and unknown categories fall back to other", () => {
  const { places } = buildPlaces([{ name: "SF list", source: "other", places: [P("Z", 1, 1, { address: "", category: "Weird" })] }], cats);
  assert.equal(places[0].addr, ""); assert.equal(places[0].c, "other");
});
test("Michelin matches attach awards by maps link, as codes", () => {
  const m = { "https://maps.google.com/?cid=9": [{ year: 2025, award: "Bib Gourmand" }, { year: 2026, award: "1 Star" }] };
  const { places } = buildPlaces([{ name: "Casual Food", source: "mine", places: [P("X", 1, 1, { maps: "https://maps.google.com/?cid=9" })] }], cats, m);
  assert.equal(places[0].mich, "25B,26S1");
});
test("bad coordinates are dropped; helpers", () => {
  assert.equal(buildPlaces([{ name: "L", source: "mine", places: [P("N", NaN, 1)] }], cats).places.length, 0);
  assert.equal(slug("SF list"), "sf-list"); assert.equal(fold("Café & Bar's"), "cafe and bars");
  assert.equal(fmtDistance(10), "50 ft"); assert.equal(fmtDistance(30), "100 ft"); assert.equal(fmtDistance(1609.344), "1.0 mi"); assert.equal(fmtDistance(40000), "25 mi");
});
test("extra locations stay separate places with a hint flag, and merge only when truly the same spot", () => {
  const { places } = buildPlaces([{ name: "Casual Food", source: "mine", places: [P("Marugame Udon", 37.7, -122.4), P("Marugame Udon", 37.75, -122.25, { extra_location: true, branch: "Alameda" }), P("Marugame Udon", 37.70001, -122.40001, { extra_location: true, branch: "Dup" })] }], cats);
  assert.equal(places.length, 2);
  const ex = places.find((p) => p.ex);
  assert.equal(ex.br, "Alameda");
  assert.equal(places.find((p) => !p.ex).br, undefined);
});
