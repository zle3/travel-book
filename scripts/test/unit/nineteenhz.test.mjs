import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { REGIONS, parseListing, regionUrl } from "../../../worker/nineteenhz.ts";

const html = fs.readFileSync(new URL("../fixtures/19hz-sample.html", import.meta.url), "utf8");

test("parses the listing table: title, venue, city, genres, price and age, date from the trailing YYYY/MM/DD", () => {
  const ev = parseListing(html);
  assert.equal(ev.length, 6);
  const e = ev[2];
  assert.equal(e.title, "Interzone - Darkwave Tuesdays");
  assert.equal(e.venue, "F8 1192 Folsom");
  assert.equal(e.city, "San Francisco");
  assert.equal(e.date, "2026-11-24");
  assert.deepEqual(e.tags, ["darkwave", "goth", "post-punk", "industrial", "EBM"]);
  assert.equal(e.price, "free b4 10 / $5");
  assert.equal(e.age, "21+");
  assert.equal(e.orgs, "Hex Embrace, Visc, Impirumcrypt");
  assert.equal(e.url, "https://ra.co/events/2585502");
  assert.equal(e.when, "Tue: Nov 24 (9pm-2am)");
  assert.equal(e.origin, "19hz");
});
test("the unclosed second cell does not swallow the genre cell", () => {
  const e = parseListing(html)[0];
  assert.equal(e.title, "Wtf: Jessika, Green Butterflies, Puppet, Finishher");
  assert.deepEqual(e.tags, ["breaks", "dubstep", "drum and bass"]);
  assert.equal(e.price, "notaflof");
});
test("rows without a date, without a title or with a hostile link are handled", () => {
  const bad = `<tbody><tr><td>x</td><td><a href='javascript:alert(1)'>Evil &amp; Co</a> @ Hall (Oakland)<td>edm</td><td>$5 | 18+</td><td></td><td></td><td><div class='shrink'>2026/12/01</div></td></tr><tr><td>x</td><td>No date @ Nowhere<td>edm</td><td></td><td></td><td></td><td>soon</td></tr></tbody>`;
  const ev = parseListing(bad);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].title, "Evil & Co");
  assert.equal(ev[0].url, "");
  assert.equal(ev[0].city, "Oakland");
  assert.deepEqual(parseListing("<html>nothing</html>"), []);
});
test("ids are stable and region URLs are the three listings", () => {
  assert.equal(parseListing(html)[1].id, parseListing(html)[1].id);
  assert.equal(regionUrl("bayarea"), "https://19hz.info/eventlisting_BayArea.php");
  assert.deepEqual(Object.keys(REGIONS), ["bayarea", "seattle", "losangeles"]);
  assert.equal(regionUrl("losangeles"), "https://19hz.info/eventlisting_LosAngeles.php");
});
