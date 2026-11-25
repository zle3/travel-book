export interface Embed { title?: string; description?: string; url?: string; provider?: string; fields?: Array<{ name: string; value: string }> }
export interface IncomingMessage {
  id: string; channelId: string; authorId: string; authorBot: boolean; system: boolean;
  content: string; embeds: Embed[]; images: string[]; createdMs: number;
}
export interface ParsedItem {
  kind: "place" | "event" | "unclear";
  name: string; date: string | null; time: string | null; venue: string; city: string;
  lat: number | null; lng: number | null; url: string; category: string | null; public: boolean;
  /** Set by the bot's own rules (never by the model): this item can never be public. */
  forcedPrivate: boolean;
}
export interface Chat {
  react(channelId: string, messageId: string, emoji: string): Promise<void>;
  unreact(channelId: string, messageId: string, emoji: string): Promise<void>;
  /** Returns the thread id. Reuses the message's thread when it already has one. */
  startThread(channelId: string, messageId: string, name: string): Promise<string>;
  send(threadId: string, text: string): Promise<string>;
  edit(threadId: string, messageId: string, text: string): Promise<void>;
  fetchSince(channelId: string, afterId: string): Promise<IncomingMessage[]>;
  fetchMessage(channelId: string, messageId: string): Promise<IncomingMessage | null>;
  latestId(channelId: string): Promise<string | null>;
  /** Emojis currently tapped by a non-bot user (the owner when ownerId is given). null = message gone. */
  tappedEmojis(channelId: string, messageId: string, ownerId: string | null): Promise<string[] | null>;
}
export interface ApiItemRef { kind: "place" | "event"; id: string; name: string; private: boolean }
export interface Api {
  create(kind: "place" | "event", fields: Record<string, unknown>): Promise<string>;
  patchPrivate(kind: "place" | "event", id: string, priv: boolean): Promise<void>;
  remove(kind: "place" | "event", id: string): Promise<void>;
  /** Items the API already holds for a Discord message (crash recovery, so a retry never double-files). */
  byMessage(messageId: string): Promise<ApiItemRef[]>;
}
export class ParseError extends Error {
  retryable: boolean; refusal: boolean;
  constructor(message: string, opts: { retryable: boolean; refusal?: boolean }) { super(message); this.retryable = opts.retryable; this.refusal = opts.refusal ?? false; }
}
export interface Parser { parse(input: { content: string; embeds: Embed[]; images: string[]; nowIso: string }): Promise<ParsedItem[]>; }
