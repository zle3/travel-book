import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { ClaudeParser, SCHEMA, SYSTEM_PROMPT, buildContent, sanitize } from "../src/parser.ts";
import { looksPrivate } from "../src/privacy.ts";
import { loadConfig } from "../src/config.ts";
import { CATEGORY_LABELS, CATEGORY_IDS } from "../src/categories.ts";
import { ParseError } from "../src/types.ts";

const good = { items: [{ kind: "place", name: "Cafe", date: null, time: null, venue: "", city: "SF", lat: 37.7, lng: -122.4, url: "https://e.com", category: "Casual Food", public: true }] };
const reply = (text: string, stop = "end_turn") => ({ stop_reason: stop, content: [{ type: "text", text }] });
const input = { content: "hi", embeds: [], images: [], nowIso: "2026-11-25T10:00:00Z" };

test("request: default model, structured output schema, fallbacks beta, images as image blocks, embeds as text", async () => {
  let body: Record<string, any> = {};
  const p = new ClaudeParser({ model: "claude-opus-5-5", create: async (b) => { body = b; return reply(JSON.stringify(good)); } });
  const out = await p.parse({ ...input, content: "look", embeds: [{ title: "Cafe page", description: "great coffee", url: "https://e.com", provider: "e.com" }], images: ["https://cdn.discordapp.com/a.png", "http://insecure/x.png"] });
  assert.equal(out[0]!.name, "Cafe");
  assert.equal(body.model, "claude-opus-5-5");
  assert.deepEqual(body.output_config.format, { type: "json_schema", schema: SCHEMA });
  assert.deepEqual(body.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(body.fallbacks, "default");
  const blocks = body.messages[0].content;
  assert.equal(blocks.filter((b: any) => b.type === "image").length, 1); // https only
  assert.deepEqual(blocks[0], { type: "image", source: { type: "url", url: "https://cdn.discordapp.com/a.png" } });
  const text = blocks.at(-1).text as string;
  assert.match(text, /great coffee/);
  assert.match(text, /<post>\nlook\n<\/post>/);
  assert.match(SYSTEM_PROMPT, /untrusted data/);
});

test("the schema offers exactly the fixed category list", () => {
  const e = (SCHEMA.properties.items.items.properties.category as unknown as { enum: Array<string | null> }).enum;
  assert.deepEqual(e.filter(Boolean), [...CATEGORY_LABELS]);
  assert.equal(CATEGORY_LABELS.length, 25);
});

test("refusal and cut-off outputs are errors with the right retry flag", async () => {
  const mk = (r: unknown) => new ClaudeParser({ model: "m", create: async () => r as never });
  await assert.rejects(mk(reply("", "refusal")).parse(input), (e: ParseError) => e.refusal && !e.retryable);
  await assert.rejects(mk(reply("{", "max_tokens")).parse(input), (e: ParseError) => e.retryable);
  await assert.rejects(mk(reply("not json")).parse(input), (e: ParseError) => e.retryable);
});

test("API errors: 5xx retryable, 401 not", async () => {
  const mk = (status: number) => new ClaudeParser({ model: "m", create: async () => { throw Object.assign(new Error("x"), { status }); } });
  await assert.rejects(mk(529).parse(input), (e: ParseError) => e.retryable);
  await assert.rejects(mk(401).parse(input), (e: ParseError) => !e.retryable);
});

test("sanitize: never trusts the model (bad category, coordinates, urls, private by default)", () => {
  const [a, b, c] = sanitize({ items: [
    { kind: "place", name: "A", category: "Casino", lat: 999, lng: 1, url: "javascript:alert(1)", public: "yes" },
    { kind: "event", name: "B", date: "soon", time: "25:99", category: "Fine Dining", lat: 1, lng: 2, public: true },
    { kind: "place", name: "", category: "Parks", public: true },
  ] });
  assert.equal(a!.category, null); assert.equal(a!.lat, null); assert.equal(a!.url, ""); assert.equal(a!.public, false);
  assert.equal(b!.category, "Event"); assert.equal(b!.date, null); assert.equal(b!.time, null);
  assert.equal(c, undefined); // nameless place dropped
  assert.throws(() => sanitize({}), ParseError);
});

test("private text rules", () => {
  for (const t of ["got my tickets for friday", "confirmation number: ABC123", "Booking ref XJ39PQ hotel", "I'm going to this!", "our trip to Seoul", "marked private", "boarding pass attached", "reservation code 8F2K9Z"]) assert.ok(looksPrivate(t), t);
  for (const t of ["great ramen spot https://x.com", "Free show at the park on Saturday", "tickets on sale now at the venue site"]) assert.ok(!looksPrivate(t), t);
});

test("config: model default and override, key optional, required vars, interval default", () => {
  const base = { DISCORD_BOT_TOKEN: "t", DISCORD_PLANNER_CHANNEL_ID: "1", ADMIN_TOKEN: "a" };
  const c = loadConfig(base);
  assert.equal(c.model, "claude-opus-5-5");
  assert.equal(c.anthropicKey, null);
  assert.equal(c.checkIntervalMin, 5);
  assert.equal(loadConfig({ ...base, ANTHROPIC_MODEL: "claude-sonnet-5-5", ANTHROPIC_API_KEY: "k", CHECK_INTERVAL_MIN: "2" }).model, "claude-sonnet-5-5");
  assert.equal(loadConfig({ ...base, ANTHROPIC_API_KEY: "  " }).anthropicKey, null);
  assert.equal(loadConfig({ ...base, CHECK_INTERVAL_MIN: "2" }).checkIntervalMin, 2);
  assert.throws(() => loadConfig({ ...base, ADMIN_TOKEN: "" }), /ADMIN_TOKEN/);
  assert.throws(() => loadConfig({}), /required/);
});

test("category list matches the API copy and the site's category ids", () => {
  const api = readFileSync(new URL("../../api/src/categories.ts", import.meta.url), "utf8").split("\n").slice(0);
  const mine = readFileSync(new URL("../src/categories.ts", import.meta.url), "utf8").split("\n").slice(1);
  assert.equal(api.join("\n").trim(), mine.join("\n").trim());
  const site = new URL("../../../src/assets/design/categories.json", import.meta.url);
  if (existsSync(site)) {
    const ids: string[] = JSON.parse(readFileSync(site, "utf8")).categories.map((c: { id: string }) => c.id);
    for (const id of ids) assert.ok(CATEGORY_IDS.has(id), id);
    assert.deepEqual([...CATEGORY_IDS].filter((i) => !ids.includes(i)), ["event"]);
  }
});

test("buildContent with no images has just the text block", () => {
  assert.equal(buildContent(input).length, 1);
});
