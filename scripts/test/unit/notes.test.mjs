import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanNote } from "../../../scripts/data/notes.mjs";

test("a note that is only a score is dropped; so is a score with one word", () => {
  assert.equal(cleanNote("8.4"), "");
  assert.equal(cleanNote("7.9 matcha"), "");
  assert.equal(cleanNote(" 8.3 matcha "), "");
  assert.equal(cleanNote(undefined), "");
});
test("text notes and phrases with a year stay exactly as written", () => {
  assert.equal(cleanNote("Michelin Gourmand Bib 2025"), "Michelin Gourmand Bib 2025");
  assert.equal(cleanNote("8.0 egg tart, cake"), "8.0 egg tart, cake");
  assert.equal(cleanNote("East End Garage\nM-F 4pm ; Wkd 11am"), "East End Garage\nM-F 4pm ; Wkd 11am");
  assert.equal(cleanNote("2025 Michelin"), "2025 Michelin");
});
