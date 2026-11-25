// Race (node only): the guide resolver matches by name (case and punctuation insensitive), breaks ties by address then by the
// anchor, turns coordinate-only items into guide-only pins with valid pick ids, and drops items it cannot place.
import assert from "node:assert/strict";
import { guidePlaceId, resolveGuide } from "../../../src/lib/guides.ts";

export default async function () {
  const P = (id, n, x, y, addr) => ({ id, n, c: "casual-food", x, y, addr });
  const places = [
    P("a1", "Kiss of Matcha", -122.40, 37.80, "614 Broadway, San Francisco, CA"),
    P("a2", "Kiss of Matcha", -122.47, 37.78, "750 Clement Street, San Francisco, CA"),
    P("b1", "Bread n' Chu", -122.47, 37.78, "Clement Street, San Francisco, CA"),
    P("c1", "Na Ya", -122.43, 37.78, "535 Octavia Street, San Francisco, CA"),
    P("c2", "Na Ya", -122.47, 37.78, "5340 Geary Blvd, San Francisco, CA"),
  ];
  const guide = {
    id: "t", city: "San Francisco", title: "T", subtitle: "s",
    anchor: { name: "Anchor Cafe", address: "1 A St", lat: 37.78, lng: -122.475 },
    groups: [
      { title: "Food", items: [{ name: "KISS of matcha" }, { name: "bread N chu" }, { name: "Na Ya", address: "535 Octavia St" }, { name: "Ghost Place" }] },
      { title: "Museums and art", items: [{ name: "de Young", lat: 37.77, lng: -122.46, note: "art" }] },
    ],
  };
  const r = resolveGuide(guide, places);
  const ids = r.groups[0].items.map((i) => i.place.id);
  assert.deepEqual(ids, ["a2", "b1", "c1"], "case/punctuation-insensitive; nearest to the anchor breaks a tie; the address beats the anchor; unknown names are dropped");
  const de = r.groups[1].items[0];
  assert.ok(de.guideOnly && de.place.c === "museums" && de.note === "art", "a coordinate-only item is a guide-only museum pin");
  assert.match(de.place.id, /^[0-9a-z]{1,16}$/, "its id is a valid pick id");
  assert.equal(r.extras.length, 2, "the guide-only anchor and the museum");
  assert.ok(r.anchor.guideOnly, "an unmatched anchor with coordinates is a pin too");
  assert.equal(r.places.length, 5, "anchor + 3 matches + museum");
  assert.ok(r.bounds[0] <= -122.475 && r.bounds[2] >= -122.43, "bounds cover every pin");
  assert.notEqual(guidePlaceId("a", 0), guidePlaceId("b", 0));
}
