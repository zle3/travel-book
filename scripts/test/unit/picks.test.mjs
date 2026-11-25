import { test } from "node:test";
import assert from "node:assert/strict";
import { cityOf, cleanIds, decodePicks, encodePicks, picksText, shareUrl } from "../../../src/lib/picks.ts";

test("encode then decode round trips ids from a share link", () => {
  const ids = ["abc123", "x9", "k5q8z2"];
  const url = shareUrl("https://travel.zachle.info/", ids);
  assert.equal(url, "https://travel.zachle.info/#picks=abc123,x9,k5q8z2");
  assert.deepEqual(decodePicks(new URL(url).hash), ids);
  assert.deepEqual(decodePicks("?x=1&picks=a,b"), ["a", "b"]);
  assert.deepEqual(decodePicks("a,b c"), ["a", "b", "c"]);
});
test("decode ignores junk, duplicates and unsafe ids, and never throws", () => {
  assert.deepEqual(decodePicks("#picks=a,a,<script>,b%2Cc"), ["a", "b", "c"]);
  assert.deepEqual(decodePicks("#picks=a,%E0%A4%A"), ["a"]);
  assert.deepEqual(cleanIds(["ok1", "NOT OK", "../x", 5, null, "ok1"]), ["ok1"]);
  assert.deepEqual(decodePicks("#picks="), []);
  assert.deepEqual(decodePicks("#picks=%ZZ"), []);
});
test("a huge list is capped", () => {
  assert.equal(encodePicks(Array.from({ length: 900 }, (_, i) => `i${i}`)).split(",").length, 500);
});
test("copy as text lists names with category, area and map link", () => {
  const t = picksText([{ name: "Rintaro", category: "Sit Down Restaurants", area: "San Francisco", maps: "https://maps.example/1" }, { name: "Park", category: "", area: "", maps: "" }], "https://x/#picks=a");
  assert.match(t, /^My picks from Little Travel Book:\n- Rintaro \(Sit Down Restaurants, San Francisco\) https:\/\/maps.example\/1\n- Park\n/);
  assert.match(t, /Open them on the map: https:\/\/x\/#picks=a$/);
});
test("city is read from a street address, empty when unknown", () => {
  assert.equal(cityOf("603 Bush St, San Francisco, CA 94108"), "San Francisco");
  assert.equal(cityOf(""), "");
  assert.equal(cityOf("Somewhere, CA"), "Somewhere");
});
