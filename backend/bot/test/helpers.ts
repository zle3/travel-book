import { Store } from "../src/store.ts";
import { Planner } from "../src/planner.ts";
import type { Api, ApiItemRef, Chat, IncomingMessage, ParsedItem, Parser } from "../src/types.ts";

export const CH = "100";
export const OWNER = "42";

export class FakeChat implements Chat {
  calls: string[] = [];
  messages: IncomingMessage[] = [];
  taps = new Map<string, string[]>();        // what Discord currently shows as tapped (non-bot)
  edits = new Map<string, string>();          // reply message id -> latest text
  sent: Array<{ threadId: string; text: string }> = [];
  threads = new Map<string, string>();
  fail = new Set<string>();
  private n = 1000;
  private rec(c: string): void { this.calls.push(c); if (this.fail.has(c)) throw new Error(`fake failure: ${c}`); }
  async react(_c: string, m: string, e: string): Promise<void> { this.rec(`react:${m}:${e}`); }
  async unreact(_c: string, m: string, e: string): Promise<void> { this.rec(`unreact:${m}:${e}`); }
  async startThread(_c: string, m: string): Promise<string> { this.rec(`thread:${m}`); const id = this.threads.get(m) ?? `t${m}`; this.threads.set(m, id); return id; }
  async send(t: string, text: string): Promise<string> { this.rec(`send:${t}`); const id = String(++this.n); this.sent.push({ threadId: t, text }); this.edits.set(id, text); return id; }
  async edit(_t: string, id: string, text: string): Promise<void> { this.rec(`edit:${id}`); this.edits.set(id, text); }
  async fetchSince(_c: string, after: string): Promise<IncomingMessage[]> { return this.messages.filter((m) => BigInt(m.id) > BigInt(after)).slice(0, 100); }
  async fetchMessage(_c: string, id: string): Promise<IncomingMessage | null> { return this.messages.find((m) => m.id === id) ?? null; }
  async latestId(): Promise<string | null> { return this.messages.length ? this.messages[this.messages.length - 1]!.id : null; }
  async tappedEmojis(_c: string, id: string): Promise<string[] | null> { return this.taps.get(id) ?? []; }
  count(prefix: string): number { return this.calls.filter((c) => c.startsWith(prefix)).length; }
  lastReply(): string { return [...this.edits.values()].pop() ?? ""; }
}

interface Stored extends ApiItemRef { fields: Record<string, unknown>; msg: string }
export class FakeApi implements Api {
  items = new Map<string, Stored>();
  ops: string[] = [];
  private n = 0;
  async create(kind: "place" | "event", fields: Record<string, unknown>): Promise<string> {
    const id = `a${++this.n}`; this.ops.push(`create:${kind}`);
    this.items.set(id, { kind, id, name: String(fields.name ?? fields.title), private: fields.private === true, fields, msg: String(fields.msg_id) });
    return id;
  }
  async patchPrivate(_k: "place" | "event", id: string, priv: boolean): Promise<void> { this.ops.push(`private:${priv}`); this.items.get(id)!.private = priv; }
  async remove(_k: "place" | "event", id: string): Promise<void> { this.ops.push("remove"); this.items.delete(id); }
  async byMessage(m: string): Promise<ApiItemRef[]> { return [...this.items.values()].filter((i) => i.msg === m); }
  live(): Stored[] { return [...this.items.values()].filter((i) => !i.private); }
  count(op: string): number { return this.ops.filter((o) => o.startsWith(op)).length; }
}

export const place = (over: Partial<ParsedItem> = {}): ParsedItem => ({ kind: "place", name: "Blue Bottle", date: null, time: null, venue: "", city: "SF", lat: 37.78, lng: -122.41, url: "https://example.com", category: "Tea/Drinks", public: true, forcedPrivate: false, ...over });
export const event = (over: Partial<ParsedItem> = {}): ParsedItem => place({ kind: "event", name: "Show", date: "2026-12-05", time: "20:00", venue: "Fillmore", category: "Event", lat: null, lng: null, ...over });

export class FakeParser implements Parser {
  calls = 0;
  result: ParsedItem[] | Error = [place()];
  async parse(): Promise<ParsedItem[]> { this.calls++; if (this.result instanceof Error) throw this.result; return this.result; }
}

export const msg = (id: string, content = "check out this cafe https://example.com", over: Partial<IncomingMessage> = {}): IncomingMessage =>
  ({ id, channelId: CH, authorId: OWNER, authorBot: false, system: false, content, embeds: [], images: [], createdMs: Date.now(), ...over });

export function setup(opts: { parser?: Parser | null; ownerId?: string | null; maxAttempts?: number; now?: () => number } = {}) {
  const store = new Store(":memory:"); const chat = new FakeChat(); const api = new FakeApi();
  const parser = opts.parser === undefined ? new FakeParser() : opts.parser;
  const logs: string[] = [];
  const planner = new Planner({ store, chat, api, parser, channelId: CH, ownerId: opts.ownerId ?? null, now: opts.now ?? Date.now, log: (m) => logs.push(m), maxAttempts: opts.maxAttempts ?? 5, windowMs: 14 * 86_400_000 });
  return { store, chat, api, parser, planner, logs };
}
