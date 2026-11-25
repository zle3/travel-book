import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { hoodSlug, inHood, inPoly, parseCityHash, cityHash } from "../../../src/lib/hoods.ts";

test("hoods file is current, under 80 KB gzipped, labels inside shapes", () => {
  execFileSync("node", ["scripts/data/build-hoods.mjs", "--check"], { stdio: "pipe" });
  const text = fs.readFileSync("public/data/hoods/sf.json", "utf8");
  assert.ok(zlib.gzipSync(text).length < 80 * 1024);
  const f = JSON.parse(text);
  assert.equal(f.hoods.length, 41);
  for (const h of f.hoods) assert.ok(inHood(h.c[0], h.c[1], h), `${h.n} label inside`);
});
test("simplified shapes assign every place like the raw DataSF polygons", () => {
  const f = JSON.parse(fs.readFileSync("public/data/hoods/sf.json", "utf8"));
  const raw = JSON.parse(fs.readFileSync("data/sf-neighborhoods.geojson", "utf8")).features.map((x) => ({ s: hoodSlug(x.properties.nhood), p: x.geometry.type === "Polygon" ? [x.geometry.coordinates] : x.geometry.coordinates }));
  const manifest = JSON.parse(fs.readFileSync("src/generated/manifest.json", "utf8"));
  const places = JSON.parse(fs.readFileSync(`public${manifest.places}`, "utf8")).features;
  const inv = new Map(Object.entries(f.in).flatMap(([s, ids]) => ids.map((id) => [id, s])));
  let n = 0;
  for (const pl of places) {
    const [x, y] = pl.geometry.coordinates;
    if (x < -122.53 || x > -122.33 || y < 37.69 || y > 37.84) continue;
    const r = raw.find((q) => q.p.some((poly) => inPoly(x, y, poly)));
    assert.equal(inv.get(pl.properties.id) ?? null, r?.s ?? null, pl.properties.n);
    n++;
  }
  assert.ok(n > 400);
});
test("city hash parse and build", () => {
  assert.deepEqual(parseCityHash("#city=sf&hood=north-beach"), { city: true, hood: "north-beach" });
  assert.deepEqual(parseCityHash("#city=la&hood=x"), { city: false, hood: null });
  assert.deepEqual(parseCityHash("#city=sf&hood=../x"), { city: true, hood: null });
  assert.equal(cityHash(true, "mission"), "#city=sf&hood=mission");
  assert.equal(cityHash(false, null), "");
});
