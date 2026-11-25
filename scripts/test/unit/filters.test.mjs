import { test } from "node:test";
import assert from "node:assert/strict";
import { activeCount, awardKinds, defaultFilters, matches, parseFilters, toggleCats } from "../../../src/lib/filters.ts";

const ctx = { currentEdition: 2026 };
const mk = (o = {}) => ({ c: "casual-food", s: "m", l: ["casual-food"], x: -122.41, y: 37.77, ...o });

test("defaults show everything and count zero", () => {
  assert.equal(matches(mk(), defaultFilters(), ctx), true);
  assert.equal(activeCount(defaultFilters()), 0);
});
test("source toggles hide my lists or other lists independently", () => {
  assert.equal(matches(mk({ s: "m" }), { ...defaultFilters(), mine: false }, ctx), false);
  assert.equal(matches(mk({ s: "o" }), { ...defaultFilters(), mine: false }, ctx), true);
  assert.equal(matches(mk({ s: "o" }), { ...defaultFilters(), other: false }, ctx), false);
});
test("categories narrow; a place on two lists stays while one list is on", () => {
  assert.equal(matches(mk(), { ...defaultFilters(), cats: ["parks"] }, ctx), false);
  assert.equal(matches(mk(), { ...defaultFilters(), cats: ["casual-food"] }, ctx), true);
  assert.equal(matches(mk({ l: ["casual-food", "sf-list"] }), { ...defaultFilters(), offLists: ["casual-food"] }, ctx), true);
  assert.equal(matches(mk({ l: ["casual-food"] }), { ...defaultFilters(), offLists: ["casual-food"] }, ctx), false);
});
test("region filter uses the metro boxes, with Elsewhere for the rest", () => {
  assert.equal(matches(mk(), { ...defaultFilters(), regions: ["sf"] }, ctx), true);
  assert.equal(matches(mk(), { ...defaultFilters(), regions: ["sea", "nyc"] }, ctx), false);
  assert.equal(matches(mk({ x: -84.39, y: 33.75 }), { ...defaultFilters(), regions: ["other"] }, ctx), true);
});
test("Michelin chips: stars and bib; any year versus current edition only", () => {
  const p = mk({ mich: "22S1,23S1,24B" });
  assert.deepEqual(awardKinds(p.mich, true, 2026).sort(), ["bib", "star"]);
  assert.deepEqual(awardKinds(p.mich, false, 2026), []);
  assert.equal(matches(p, { ...defaultFilters(), mich: ["star"] }, ctx), true);
  assert.equal(matches(p, { ...defaultFilters(), mich: ["star"], anyYear: false }, ctx), false);
  assert.equal(matches(mk(), { ...defaultFilters(), mich: ["bib"] }, ctx), false);
  assert.equal(matches(mk({ mich: "26B" }), { ...defaultFilters(), mich: ["bib"], anyYear: false }, ctx), true);
});
test("hide been", () => {
  assert.equal(matches(mk({ been: true }), { ...defaultFilters(), hideBeen: true }, ctx), false);
  assert.equal(matches(mk({ been: false }), { ...defaultFilters(), hideBeen: true }, ctx), true);
});
test("active count counts each narrowing control once", () => {
  assert.equal(activeCount({ ...defaultFilters(), cats: ["a", "b"], regions: ["sf"], mich: ["star"], anyYear: false, michelinLayer: true }), 5);
});
test("a chip toggles all its categories on, then off", () => {
  const ids = ["tea-drinks"];
  assert.deepEqual(toggleCats([], ids), ids);
  assert.deepEqual(toggleCats(["parks", "tea-drinks"], ids), ["parks"]);
  assert.deepEqual(toggleCats(["bakery"], ["bakery", "desserts"]), ["bakery", "desserts"]);
});
test("parseFilters survives junk and keeps valid fields", () => {
  assert.deepEqual(parseFilters(null), defaultFilters());
  assert.deepEqual(parseFilters("x"), defaultFilters());
  const f = parseFilters({ mine: false, cats: ["a", 3], mich: ["star", "nope"], anyYear: false, regions: "sf" });
  assert.equal(f.mine, false); assert.deepEqual(f.cats, ["a"]); assert.deepEqual(f.mich, ["star"]); assert.equal(f.anyYear, false); assert.deepEqual(f.regions, []);
});
