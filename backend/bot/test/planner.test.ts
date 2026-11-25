import { test } from "node:test";
import assert from "node:assert/strict";
import { setup, msg, place, event, FakeParser, CH, OWNER } from "./helpers.ts";
import { ParseError } from "../src/types.ts";
import { REPLY_QUEUED, REPLY_WORKING, threadName } from "../src/planner.ts";

const tap = (p: ReturnType<typeof setup>, id: string, emoji: string, on = true) => p.planner.onReaction(id, emoji, OWNER, false, on);

test("new post: ✅ first, then routing emojis in order, thread with the working reply, then filed", async () => {
  const s = setup();
  await s.planner.onMessage(msg("1"));
  const reacts = s.chat.calls.filter((c) => c.startsWith("react:")).map((c) => c.split(":")[2]);
  assert.deepEqual(reacts, ["✅", "📅", "🎟️", "📍", "💭", "🔒", "❌"]);
  assert.equal(s.chat.calls[0], "react:1:✅");
  assert.equal(s.chat.sent.length, 1);
  assert.equal(s.chat.sent[0]!.text, REPLY_WORKING);
  assert.equal(s.chat.count("send:"), 1); // a single bot message, then edited
  assert.equal(s.api.live().length, 1);
  assert.match(s.chat.lastReply(), /Blue Bottle \(Tea\/Drinks\): live on the site/);
  assert.equal(s.store.get("1")!.status, "filed");
});

test("ignored: other channel, bots, system messages, other users when an owner is set, own reactions", async () => {
  const s = setup({ ownerId: OWNER });
  await s.planner.onMessage(msg("1", "x", { channelId: "999" }));
  await s.planner.onMessage(msg("2", "x", { authorBot: true }));
  await s.planner.onMessage(msg("3", "x", { system: true }));
  await s.planner.onMessage(msg("4", "x", { authorId: "7" }));
  assert.equal(s.chat.calls.length, 0);
  await s.planner.onMessage(msg("5"));
  await s.planner.onReaction("5", "🔒", "bot", true, true);
  await s.planner.onReaction("5", "🔒", "7", false, true); // not the owner
  await s.planner.onReaction("nope", "🔒", OWNER, false, true); // unknown message
  assert.equal(s.api.live().length, 1);
});

test("🔒 tap hides the item at once, un-tap shows it again", async () => {
  const s = setup();
  await s.planner.onMessage(msg("1"));
  await tap(s, "1", "🔒");
  assert.equal(s.api.live().length, 0);
  assert.equal(s.api.items.size, 1);
  assert.match(s.chat.lastReply(), /private, not on the site/);
  await tap(s, "1", "🔒", false);
  assert.equal(s.api.live().length, 1);
  assert.equal(s.parser && (s.parser as FakeParser).calls, 1); // taps never re-spend a parse
});

test("items the model or the bot's text rules call private never go public, even after 🔒 is removed", async () => {
  const s = setup();
  (s.parser as FakeParser).result = [place({ public: false })];
  await s.planner.onMessage(msg("1"));
  assert.equal(s.api.live().length, 0);
  await tap(s, "1", "🔒"); await tap(s, "1", "🔒", false);
  assert.equal(s.api.live().length, 0);
  const t = setup();
  await t.planner.onMessage(msg("2", "dinner here, my tickets are bought, confirmation #AB12CD"));
  assert.equal(t.api.live().length, 0);
  assert.equal(t.api.items.size, 1);
});

test("🎟️ files the item privately", async () => {
  const s = setup();
  (s.parser as FakeParser).result = [event()];
  await s.planner.onMessage(msg("1", "show"));
  assert.equal(s.api.live().length, 1);
  await tap(s, "1", "🎟️");
  assert.equal(s.api.live().length, 0);
});

test("❌ deletes the message's items and reacts 🗑️; removing ❌ restores them and the 🗑️ without a new parse", async () => {
  const s = setup();
  await s.planner.onMessage(msg("1"));
  await tap(s, "1", "❌");
  assert.equal(s.api.items.size, 0);
  assert.ok(s.chat.calls.includes("react:1:🗑️"));
  assert.equal(s.store.get("1")!.status, "removed");
  await tap(s, "1", "❌", false);
  assert.ok(s.chat.calls.includes("unreact:1:🗑️"));
  assert.equal(s.api.live().length, 1);
  assert.equal((s.parser as FakeParser).calls, 1);
  assert.equal(s.store.get("1")!.status, "filed");
});

test("❌ before parsing finishes (queued) means it is never parsed", async () => {
  const s = setup({ parser: null });
  await s.planner.onMessage(msg("1"));
  await tap(s, "1", "❌");
  const p = new FakeParser();
  (s.planner as unknown as { d: { parser: unknown } }).d.parser = p;
  await s.planner.sweep(); await s.planner.sweep();
  assert.equal(p.calls, 0);
  assert.equal(s.api.items.size, 0);
});

test("📅 / 📍 route by kind, 💭 files nothing", async () => {
  const s = setup();
  (s.parser as FakeParser).result = [place(), event()];
  await s.planner.onMessage(msg("1"));
  assert.equal(s.api.items.size, 2);
  await tap(s, "1", "📅");
  assert.deepEqual([...s.api.items.values()].map((i) => i.kind), ["event"]);
  await tap(s, "1", "📅", false); await tap(s, "1", "📍");
  assert.deepEqual([...s.api.items.values()].map((i) => i.kind), ["place"]);
  await tap(s, "1", "📍", false); await tap(s, "1", "💭");
  assert.equal(s.api.items.size, 0);
  await tap(s, "1", "💭", false);
  assert.equal(s.api.items.size, 2);
});

test("no API key: queued reply, nothing filed, nothing parsed", async () => {
  const s = setup({ parser: null });
  await s.planner.onMessage(msg("1"));
  assert.equal(s.chat.lastReply(), REPLY_QUEUED);
  assert.equal(s.store.get("1")!.status, "queued");
  assert.equal(s.api.items.size, 0);
  await s.planner.sweep(); await s.planner.sweep();
  assert.equal(s.chat.lastReply(), REPLY_QUEUED);
  assert.equal(s.chat.count("edit:"), 1);
});

test("a key added later: the queued post is parsed and filed on the next pass, once", async () => {
  const s = setup({ parser: null });
  await s.planner.onMessage(msg("1"));
  s.chat.messages.push(msg("1"));
  s.store.setKv("last_id", "1");
  const p = new FakeParser();
  (s.planner as unknown as { d: { parser: unknown } }).d.parser = p;
  await s.planner.sweep(); await s.planner.sweep();
  assert.equal(p.calls, 1);
  assert.equal(s.api.count("create"), 1);
  assert.equal(s.store.get("1")!.status, "filed");
});

test("unclear, no pin, no date: left for the planner run, honestly said", async () => {
  const s = setup();
  (s.parser as FakeParser).result = [place({ kind: "unclear", name: "hm" }), place({ name: "No pin", lat: null, lng: null }), event({ name: "No date", date: null })];
  await s.planner.onMessage(msg("1"));
  assert.equal(s.api.items.size, 0);
  assert.equal(s.store.get("1")!.status, "manual");
  assert.match(s.chat.lastReply(), /needs a pin/);
  assert.match(s.chat.lastReply(), /needs a date/);
});

test("parse failure retries with backoff, then gives up to the planner run", async () => {
  let t = 1_000_000;
  const s = setup({ maxAttempts: 3, now: () => t });
  (s.parser as FakeParser).result = new ParseError("overloaded", { retryable: true });
  s.chat.messages.push(msg("1")); s.store.setKv("last_id", "0");
  await s.planner.onMessage(msg("1"));
  assert.equal(s.store.get("1")!.status, "failed");
  await s.planner.sweep(); // not due yet
  assert.equal((s.parser as FakeParser).calls, 1);
  t += 6 * 60_000; await s.planner.sweep();
  assert.equal((s.parser as FakeParser).calls, 2);
  t += 11 * 60_000; await s.planner.sweep();
  assert.equal(s.store.get("1")!.status, "manual");
  assert.match(s.chat.lastReply(), /several tries/);
  t += 60 * 60_000; await s.planner.sweep();
  assert.equal((s.parser as FakeParser).calls, 3);
});

test("a retry that works files it", async () => {
  let t = 0;
  const s = setup({ now: () => t });
  (s.parser as FakeParser).result = new ParseError("overloaded", { retryable: true });
  s.chat.messages.push(msg("1")); s.store.setKv("last_id", "0");
  await s.planner.onMessage(msg("1"));
  (s.parser as FakeParser).result = [place()];
  t += 6 * 60_000; await s.planner.sweep();
  assert.equal(s.api.live().length, 1);
});

test("a model refusal is not retried", async () => {
  const s = setup();
  (s.parser as FakeParser).result = new ParseError("model refused", { retryable: false, refusal: true });
  await s.planner.onMessage(msg("1"));
  assert.equal(s.store.get("1")!.status, "manual");
  await s.planner.sweep();
  assert.equal((s.parser as FakeParser).calls, 1);
});

test("idempotent: the same post from the gateway and the sweep is filed and reacted once", async () => {
  const s = setup();
  const m = msg("5");
  s.chat.messages.push(m); s.store.setKv("last_id", "4");
  await Promise.all([s.planner.onMessage(m), s.planner.sweep()]);
  await s.planner.sweep(); await s.planner.sweep();
  assert.equal(s.api.count("create"), 1);
  assert.equal(s.chat.count("react:5:"), 7);
  assert.equal(s.chat.count("send:"), 1);
  assert.equal(s.chat.count("thread:"), 1);
});

test("sweep catches posts missed while offline, oldest first, and moves the cursor", async () => {
  const s = setup();
  s.store.setKv("last_id", "10");
  s.chat.messages.push(msg("11", "a"), msg("12", "b"));
  await s.planner.sweep();
  assert.equal(s.api.count("create"), 2);
  assert.equal(s.store.kv("last_id"), "12");
  await s.planner.sweep();
  assert.equal(s.api.count("create"), 2);
});

test("first run does not backfill history", async () => {
  const s = setup();
  s.chat.messages.push(msg("1"), msg("2"));
  await s.planner.sweep();
  assert.equal(s.api.count("create"), 0);
  assert.equal(s.store.kv("last_id"), "2");
});

test("sweep applies taps made while the bot was down, and un-taps, and is stable on repeat", async () => {
  const s = setup();
  await s.planner.onMessage(msg("1"));
  s.chat.taps.set("1", ["🔒"]);
  await s.planner.sweep();
  assert.equal(s.api.live().length, 0);
  const ops = s.api.ops.length;
  await s.planner.sweep(); await s.planner.sweep();
  assert.equal(s.api.ops.length, ops);
  s.chat.taps.set("1", []);
  await s.planner.sweep();
  assert.equal(s.api.live().length, 1);
  s.chat.taps.set("1", ["❌"]);
  await s.planner.sweep();
  assert.equal(s.api.items.size, 0);
  assert.equal(s.chat.count("react:1:🗑️"), 1);
  await s.planner.sweep();
  assert.equal(s.chat.count("react:1:🗑️"), 1);
});

test("sweep only re-reads reactions on posts from the last 14 days", async () => {
  let t = Date.now();
  const s = setup({ now: () => t });
  await s.planner.onMessage(msg("1", "x", { createdMs: t }));
  s.store.setKv("last_id", "1");
  t += 15 * 86_400_000;
  s.chat.taps.set("1", ["🔒"]);
  await s.planner.sweep();
  assert.equal(s.api.live().length, 1);
});

test("a post stuck half-done (crash after the ✅) is finished by the sweep without repeating steps", async () => {
  let t = 0;
  const s = setup({ now: () => t });
  s.chat.fail.add("thread:7");
  await s.planner.onMessage(msg("7"));
  assert.equal(s.store.get("7")!.thread_id, null);
  assert.equal(s.store.get("7")!.status, "filed"); // filing does not depend on the thread
  s.chat.fail.delete("thread:7");
  s.store.setKv("last_id", "7");
  await s.planner.sweep();
  assert.equal(s.chat.count("react:7:"), 7);
  assert.equal(s.api.count("create"), 1);
  assert.equal(s.chat.sent.length, 1);
  assert.match(s.chat.lastReply(), /live on the site/);
});

test("crash between API create and saving it: the retry adopts the item instead of filing twice", async () => {
  const s = setup();
  await s.api.create("place", { name: "Blue Bottle", lat: 1, lng: 2, msg_id: "9", private: false });
  await s.planner.onMessage(msg("9"));
  assert.equal(s.api.items.size, 1);
  assert.equal(s.api.count("create"), 1);
});

test("an API outage leaves the post retryable by the sweep, without a second parse", async () => {
  let t = 0;
  const s = setup({ now: () => t });
  const real = s.api.create.bind(s.api);
  let down = true;
  s.api.create = async (k, f) => { if (down) throw new Error("API down"); return real(k, f); };
  s.chat.messages.push(msg("1")); s.store.setKv("last_id", "0");
  await s.planner.onMessage(msg("1")).catch(() => undefined);
  down = false;
  t += 61_000;
  await s.planner.sweep(); await s.planner.sweep();
  assert.equal(s.api.live().length, 1);
  assert.equal((s.parser as FakeParser).calls, 1);
});

test("thread names carry no mentions or links", () => {
  assert.equal(threadName("hey <@123> @everyone look https://x.com/a nice"), "hey everyone look nice");
  assert.equal(threadName("<@1>"), "Planner post");
  assert.ok(threadName("x".repeat(500)).length <= 60);
});

test("channel id constant sanity", () => { assert.equal(CH, "100"); });
