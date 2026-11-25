// Race (node only, no browser): NWS alerts pass their description and an https "More" link through to the weather sheet.
import assert from "node:assert/strict";
import { adaptNwsAlerts } from "../../../src/lib/weather.ts";

export default async function () {
  const feat = (extra, props = {}) => ({ id: "https://api.weather.gov/alerts/urn:abc", properties: { id: "urn:abc", event: "Wind Advisory", severity: "Minor", headline: "h", description: "  Winds 30 mph\n\nuntil 9 PM.  ", ...props }, ...extra });
  const [a] = adaptNwsAlerts({ features: [feat({})] });
  assert.equal(a.description, "Winds 30 mph until 9 PM.", "description is passed through, whitespace collapsed");
  assert.equal(a.url, "https://api.weather.gov/alerts/urn:abc", "an https link is passed through");
  const [b] = adaptNwsAlerts({ features: [feat({ id: "http://insecure.example/x" })] });
  assert.equal(b.url, "", "a non-https link is dropped");
  const [c] = adaptNwsAlerts({ features: [feat({ id: "javascript:alert(1)" })] });
  assert.equal(c.url, "", "a javascript: link is dropped");
  const [d] = adaptNwsAlerts({ features: [feat({}, { description: "x".repeat(2000) })] });
  assert.ok(d.description.length <= 600, "the description is capped");
}
