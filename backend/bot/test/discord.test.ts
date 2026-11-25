import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { DiscordChat, attachGateway, toIncoming, QUIET } from "../src/discord.ts";

function fakeMessage(over: Record<string, unknown> = {}) {
  const sent: any[] = []; const edited: any[] = []; const reacted: string[] = [];
  const m: any = {
    id: "5", channelId: "100", content: "hello", system: false, createdTimestamp: 1, author: { id: "42", bot: false },
    embeds: [{ title: "T", description: "D", url: "https://e.com", provider: { name: "e" }, fields: [{ name: "a", value: "b" }], image: { url: "https://i/1.png" }, thumbnail: null }],
    attachments: new Map([["1", { url: "https://cdn/a.png", contentType: "image/png" }], ["2", { url: "https://cdn/b.pdf", contentType: "application/pdf" }]]),
    thread: null, react: async (e: string) => { reacted.push(e); },
    startThread: async (o: any) => { m.threadOpts = o; return { id: "t5" }; },
    ...over,
  };
  return { m, sent, edited, reacted };
}

test("toIncoming: text, embeds, image attachments only", () => {
  const { m } = fakeMessage();
  const i = toIncoming(m);
  assert.deepEqual(i.images, ["https://cdn/a.png", "https://i/1.png"]);
  assert.equal(i.embeds[0]!.provider, "e");
  assert.equal(i.authorBot, false);
});

test("every bot message and edit carries allowedMentions that ping nobody", async () => {
  const sent: any[] = []; const edited: any[] = [];
  const thread = { isThread: () => true, isTextBased: () => true, send: async (o: any) => { sent.push(o); return { id: "9" }; }, messages: { fetch: async () => ({ edit: async (o: any) => { edited.push(o); } }) } };
  const client: any = { user: { id: "bot" }, channels: { fetch: async () => thread } };
  const chat = new DiscordChat(client);
  await chat.send("t1", "Got it, filing…");
  await chat.edit("t1", "9", "done");
  assert.deepEqual(sent[0].allowedMentions, { parse: [], repliedUser: false });
  assert.deepEqual(edited[0].allowedMentions, { parse: [], repliedUser: false });
  assert.deepEqual(QUIET, { parse: [], repliedUser: false });
});

test("startThread reuses an existing thread and creates one without mentions otherwise", async () => {
  const { m } = fakeMessage();
  const channel = { isTextBased: () => true, messages: { fetch: async () => m } };
  const chat = new DiscordChat({ user: { id: "bot" }, channels: { fetch: async () => channel } } as any);
  assert.equal(await chat.startThread("100", "5", "name"), "t5");
  assert.equal(m.threadOpts.name, "name");
  const { m: m2 } = fakeMessage({ thread: { id: "old" } });
  const chat2 = new DiscordChat({ user: { id: "bot" }, channels: { fetch: async () => ({ isTextBased: () => true, messages: { fetch: async () => m2 } }) } } as any);
  assert.equal(await chat2.startThread("100", "5", "n"), "old");
});

test("tappedEmojis ignores the bot's own reactions", async () => {
  const mk = (users: any[], name: string) => ({ emoji: { name }, users: { fetch: async () => ({ some: (f: any) => users.some(f) }) } });
  const msg: any = { reactions: { cache: new Map([["a", mk([{ id: "bot", bot: true }], "✅")], ["b", mk([{ id: "42", bot: false }], "🔒")]]) } };
  const chat = new DiscordChat({ channels: { fetch: async () => ({ isTextBased: () => true, messages: { fetch: async () => msg } }) } } as any);
  assert.deepEqual(await chat.tappedEmojis("100", "5", null), ["🔒"]);
  assert.deepEqual(await chat.tappedEmojis("100", "5", "7"), []);
});

test("gateway wiring: posts and taps reach the planner; the bot's own taps are flagged as bot", async () => {
  const client: any = new EventEmitter(); client.user = { id: "bot" };
  const seen: any[] = [];
  const planner: any = { onMessage: async (m: any) => { seen.push(["msg", m.id]); }, onReaction: async (...a: any[]) => { seen.push(["react", ...a]); } };
  attachGateway(client, new DiscordChat(client), planner, () => {});
  const { m } = fakeMessage();
  client.emit("messageCreate", m);
  client.emit("messageReactionAdd", { emoji: { name: "🔒" }, message: { id: "5" } }, { id: "42" });
  client.emit("messageReactionRemove", { emoji: { name: "🔒" }, message: { id: "5" } }, { id: "42" });
  client.emit("messageReactionAdd", { emoji: { name: "✅" }, message: { id: "5" } }, { id: "bot" });
  client.emit("messageReactionAdd", { emoji: { name: null }, message: { id: "5" } }, { id: "42" });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(seen, [["msg", "5"], ["react", "5", "🔒", "42", false, true], ["react", "5", "🔒", "42", false, false], ["react", "5", "✅", "bot", true, true]]);
});
