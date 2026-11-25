import { test } from "node:test";
import assert from "node:assert/strict";
import { CODES, LOW_MAX_ZOOM, NAME_SHARDS, TILE_Z, bestOf, codeFromText, formatAwards, parseAwards, prefix3, shardForQuery, shardOf, tileXY, tilesForBounds, tokens } from "../../../src/lib/data/michelin.ts";

test("tile bucketing: a point lands in the slippy tile of the grid zoom", () => {
  assert.deepEqual(tileXY(-122.4194, 37.7749), [5, 12]);       // San Francisco at z5
  assert.deepEqual(tileXY(139.69, 35.68), [28, 12]);           // Tokyo
  assert.deepEqual(tileXY(-180, 85), [0, 0]);
  assert.deepEqual(tileXY(179.99, -85), [2 ** TILE_Z - 1, 2 ** TILE_Z - 1]);
});
test("a viewport asks for exactly the tiles it touches", () => {
  assert.deepEqual(tilesForBounds([-122.5, 37.7, -122.3, 37.8]), ["5-12"]);
  const wide = tilesForBounds([-125, 30, -110, 40]);
  assert.ok(wide.includes("5-12") && wide.includes("5-13") && wide.includes("6-12"));
  assert.equal(new Set(wide).size, wide.length);
  assert.ok(tilesForBounds([-200, -90, 200, 90]).length <= 4 ** TILE_Z, "never more than the whole grid");
  assert.ok(LOW_MAX_ZOOM < 6);
});
test("every Michelin tile file is present for every point in the shipped data and stays small", async () => {
  const fs = await import("node:fs");
  const low = JSON.parse(fs.readFileSync("public/michelin/low.json", "utf8"));
  assert.ok(low.length > 20000);
  const dir = "public/michelin/t";
  const files = fs.readdirSync(dir);
  let n = 0;
  for (const f of files) { assert.ok(fs.statSync(`${dir}/${f}`).size < 25 * 1024 * 1024); n += JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8")).length; }
  assert.equal(n, low.length, "every point is in exactly one tile");
  for (const [lng, lat] of low.slice(0, 500)) assert.ok(files.includes(tileXY(lng, lat).join("-") + ".json") || files.includes(tileXY(lng + 0.01, lat + 0.01).join("-") + ".json"));
});
test("award codes parse, format and rank", () => {
  assert.deepEqual(parseAwards("22S1,23S1,24B,25L,x,99Q"), [{ year: 2022, code: "S1" }, { year: 2023, code: "S1" }, { year: 2024, code: "B" }, { year: 2025, code: "L" }]);
  assert.equal(formatAwards(parseAwards("22S1,25L")), "22S1,25L");
  assert.deepEqual(bestOf(parseAwards("22B,23S2,25L")), { code: "S2", year: 2023 });
  assert.equal(bestOf([]), null);
  assert.equal(codeFromText("3 Stars"), "S3"); assert.equal(codeFromText("Bib Gourmand"), "B"); assert.equal(codeFromText("Selected"), "L"); assert.equal(codeFromText("nope"), null);
  assert.deepEqual(CODES, ["L", "G", "B", "S1", "S2", "S3"]);
});
test("name search shards: stable, in range, folded, and non-Latin names still shard", () => {
  assert.equal(shardOf("fra"), shardOf("fra"));
  for (const t of ["fra", "caf", "寿司店", "بيت"]) assert.ok(shardOf(t) >= 0 && shardOf(t) < NAME_SHARDS);
  assert.equal(shardForQuery("Café"), shardOf("caf"));
  assert.equal(shardForQuery("ab"), null);
  assert.deepEqual(tokens("Le Café d'Or"), ["le", "cafe", "dor"]);
  assert.equal(prefix3("cafe"), "caf");
});
