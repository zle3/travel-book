/**
 * discord.js adapter. Types only are imported from discord.js here so tests can drive it with a fake client.
 * Every message the bot sends carries allowedMentions {parse: [], repliedUser: false}: nothing it posts can ping anyone.
 */
import type { Client, Message, TextBasedChannel, ThreadChannel } from "discord.js";
import type { Chat, Embed, IncomingMessage } from "./types.ts";
import type { Planner } from "./planner.ts";

export const QUIET = { parse: [] as never[], repliedUser: false } as const;
const cmp = (a: string, b: string): number => { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; };

export function toIncoming(m: Message): IncomingMessage {
  const embeds: Embed[] = m.embeds.map((e) => ({ title: e.title ?? undefined, description: e.description ?? undefined, url: e.url ?? undefined, provider: e.provider?.name ?? undefined, fields: e.fields.map((f) => ({ name: f.name, value: f.value })) }));
  const images = [
    ...[...m.attachments.values()].filter((a) => (a.contentType ?? "").startsWith("image/")).map((a) => a.url),
    ...m.embeds.flatMap((e) => [e.image?.url, e.thumbnail?.url].filter((u): u is string => !!u)),
  ];
  return { id: m.id, channelId: m.channelId, authorId: m.author.id, authorBot: !!m.author.bot, system: !!m.system, content: m.content ?? "", embeds, images: [...new Set(images)], createdMs: m.createdTimestamp };
}

export class DiscordChat implements Chat {
  private client: Client;
  private cache = new Map<string, Message>();
  constructor(client: Client) { this.client = client; }

  remember(m: Message): void { this.cache.set(m.id, m); if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value!); }
  private async channel(id: string): Promise<TextBasedChannel> {
    const c = await this.client.channels.fetch(id);
    if (!c || !c.isTextBased()) throw new Error(`channel ${id} is not text based`);
    return c;
  }
  private async message(channelId: string, id: string): Promise<Message> {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const m = await (await this.channel(channelId)).messages.fetch(id);
    this.remember(m);
    return m;
  }
  async react(channelId: string, messageId: string, emoji: string): Promise<void> { await (await this.message(channelId, messageId)).react(emoji); }
  async unreact(channelId: string, messageId: string, emoji: string): Promise<void> {
    const m = await this.message(channelId, messageId);
    await m.reactions.resolve(emoji)?.users.remove(this.client.user!.id);
  }
  async startThread(channelId: string, messageId: string, name: string): Promise<string> {
    const m = await this.message(channelId, messageId);
    if (m.thread) return m.thread.id;
    return (await m.startThread({ name, autoArchiveDuration: 10080 })).id;
  }
  private async thread(id: string): Promise<ThreadChannel> {
    const t = await this.client.channels.fetch(id);
    if (!t || !t.isThread()) throw new Error(`thread ${id} not found`);
    return t;
  }
  async send(threadId: string, text: string): Promise<string> { return (await (await this.thread(threadId)).send({ content: text, allowedMentions: QUIET })).id; }
  async edit(threadId: string, messageId: string, text: string): Promise<void> {
    const t = await this.thread(threadId);
    await (await t.messages.fetch(messageId)).edit({ content: text, allowedMentions: QUIET });
  }
  async fetchSince(channelId: string, afterId: string): Promise<IncomingMessage[]> {
    const batch = await (await this.channel(channelId)).messages.fetch({ after: afterId, limit: 100 });
    return [...batch.values()].sort((a, b) => cmp(a.id, b.id)).map(toIncoming);
  }
  async fetchMessage(channelId: string, messageId: string): Promise<IncomingMessage | null> {
    try { return toIncoming(await (await this.channel(channelId)).messages.fetch(messageId)); } catch { return null; }
  }
  async latestId(channelId: string): Promise<string | null> {
    const b = await (await this.channel(channelId)).messages.fetch({ limit: 1 });
    return b.first()?.id ?? null;
  }
  async tappedEmojis(channelId: string, messageId: string, ownerId: string | null): Promise<string[] | null> {
    let m: Message;
    try { m = await (await this.channel(channelId)).messages.fetch({ message: messageId, force: true }); } catch { return null; }
    const out: string[] = [];
    for (const r of m.reactions.cache.values()) {
      const users = await r.users.fetch();
      if (users.some((u) => !u.bot && (!ownerId || u.id === ownerId)) && r.emoji.name) out.push(r.emoji.name);
    }
    return out;
  }
}

type Listener = (...a: never[]) => unknown;
/** Wires the gateway events to the planner. Errors are logged, never thrown into discord.js. */
export function attachGateway(client: Client, chat: DiscordChat, planner: Planner, log: (m: string) => void): void {
  const guard = (what: string, fn: () => Promise<void>): void => { void fn().catch((e: Error) => log(`${what}: ${e.message}`)); };
  const onMsg: Listener = ((m: Message) => { chat.remember(m); guard("messageCreate", () => planner.onMessage(toIncoming(m))); }) as Listener;
  const react = (added: boolean): Listener => ((r: { emoji: { name: string | null }; message: { id: string } }, u: { id: string; bot?: boolean }) => {
    if (!r.emoji.name) return;
    guard("reaction", () => planner.onReaction(r.message.id, r.emoji.name!, u.id, u.bot === true || u.id === client.user?.id, added));
  }) as Listener;
  client.on("messageCreate", onMsg as never);
  client.on("messageReactionAdd", react(true) as never);
  client.on("messageReactionRemove", react(false) as never);
}
