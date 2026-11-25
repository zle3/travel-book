import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { adaptLive } from "../../../src/lib/client/live.ts";
import { NEW_DAYS, isNew } from "../../../src/lib/client/store.ts";

test("live items: invalid rows are dropped, text is capped, unknown categories become other, links must be http(s)", () => {
  const cats = new Set(["parks"]);
  const { places, events } = adaptLive({
    places: [{ id: "a-1", name: "Good", lat: 1, lng: 2, category: "parks", note: "n", added: "2026-11-20" }, { id: "b", name: "Bad", lat: 200, lng: 2 }, { name: "no id", lat: 1, lng: 1 }, { id: "c", name: "x".repeat(500), lat: 1, lng: 1, category: "nope" }],
    events: [{ id: "e", title: "Night", start: "2026-11-30T21:00", url: "javascript:alert(1)" }, { id: "f", title: "no date", start: "soon" }],
  }, cats);
  assert.equal(places.length, 2);
  assert.equal(places[0].id, "da1"); assert.equal(places[0].live, true); assert.equal(places[0].c, "parks");
  assert.equal(places[1].n.length, 120); assert.equal(places[1].c, "other");
  assert.equal(events.length, 1); assert.equal(events[0].url, "");
  assert.deepEqual(adaptLive(null, cats), { places: [], events: [] });
  assert.deepEqual(adaptLive({ places: "x" }, cats), { places: [], events: [] });
});
test("New badge lasts 7 days from the added date and nothing is pinned", () => {
  const added = "2026-11-20T12:00:00Z", t0 = Date.parse(added);
  assert.equal(isNew(added, t0 + 6.9 * 86400000), true);
  assert.equal(isNew(added, t0 + NEW_DAYS * 86400000 + 1000), false);
  assert.equal(isNew(undefined), false); assert.equal(isNew("garbage"), false);
});
test("the committed generated data is current (run: node scripts/data/build-data.mjs)", () => {
  execFileSync("node", ["scripts/data/build-data.mjs", "--check"], { stdio: "pipe" });
});
test("the shipped places data has no score-only notes", () => {
  const dir = new URL("../../../public/data/", import.meta.url);
  const file = fs.readdirSync(dir).find((f) => /^places\..*\.json$/.test(f));
  const feats = JSON.parse(fs.readFileSync(new URL(file, dir), "utf8")).features;
  const noise = /^\d{1,2}(?:[.,]\d{1,2})?(?:\s+[A-Za-z]+)?$/;
  assert.equal(feats.filter((f) => f.properties.note && noise.test(f.properties.note)).length, 0);
});
