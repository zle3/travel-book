import type { Api, Chat, IncomingMessage, ParsedItem, Parser } from "./types.ts";
import { ParseError } from "./types.ts";
import { Store, type FiledRef, type Row } from "./store.ts";
import { categoryId, CATEGORY_LABELS } from "./categories.ts";
import { looksPrivate } from "./privacy.ts";

export const ACK = "✅";
export const ROUTING = ["📅", "🎟️", "📍", "💭", "🔒", "❌"] as const;
export const TRASH = "🗑️";
const norm = (e: string): string => e.replace(/️/g, "");
const ROUTING_SET = new Set<string>(ROUTING.map(norm));
const label = (c: string | null): string => CATEGORY_LABELS.find((l) => categoryId(l) === categoryId(c ?? "")) ?? "";

export const REPLY_WORKING = "Got it, filing…";
export const REPLY_QUEUED = "Queued for the next planner run";

export interface PlannerDeps {
  store: Store; chat: Chat; api: Api; parser: Parser | null;
  channelId: string; ownerId: string | null;
  now: () => number; log: (m: string) => void;
  maxAttempts: number; windowMs: number;
}

const cmpId = (a: string, b: string): number => { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; };
const startOf = (i: ParsedItem): string => (i.date ? i.date + (i.time ? `T${i.time}` : "") : "");

export class Planner {
  private d: PlannerDeps;
  private locks = new Map<string, Promise<unknown>>();
  private sweeping = false;
  constructor(d: PlannerDeps) { this.d = d; }

  /** One message at a time per Discord message id; different messages run in parallel. */
  private lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.locks.set(id, next);
    void next.finally(() => { if (this.locks.get(id) === next) this.locks.delete(id); }).catch(() => undefined);
    return next;
  }
  private async safe(what: string, fn: () => Promise<unknown>): Promise<void> {
    try { await fn(); } catch (e) { this.d.log(`${what} failed: ${(e as Error).message}`); }
  }

  // ---- gateway entry points ----

  async onMessage(m: IncomingMessage): Promise<void> {
    const d = this.d;
    if (m.channelId !== d.channelId || m.authorBot || m.system) return;
    if (d.ownerId && m.authorId !== d.ownerId) return;
    const fresh = d.store.insert({ id: m.id, channelId: m.channelId, createdMs: m.createdMs, content: JSON.stringify({ content: m.content, embeds: m.embeds, images: m.images }), status: "received" });
    if (!fresh) return; // already known: the sweep finishes anything half-done
    await this.lock(m.id, async () => {
      await this.ensureAck(m.id, m.content);
      await this.process(m.id, m);
    });
  }

  async onReaction(messageId: string, emoji: string, userId: string, userIsBot: boolean, added: boolean): Promise<void> {
    const d = this.d;
    const e = norm(emoji);
    if (userIsBot || !ROUTING_SET.has(e)) return;
    if (d.ownerId && userId !== d.ownerId) return;
    if (!d.store.get(messageId)) return; // not a planner post we know; the sweep will register it if it is
    d.store.setTapped(messageId, e, added);
    await this.lock(messageId, () => this.reconcile(messageId));
  }

  // ---- acknowledgement: reactions and thread, each step recorded so a retry never repeats it ----

  private async ensureAck(id: string, text?: string): Promise<void> {
    const d = this.d;
    const row = d.store.get(id)!;
    const reacted = new Set<string>(JSON.parse(row.reacted) as string[]);
    const react = async (emoji: string): Promise<void> => {
      if (reacted.has(norm(emoji))) return;
      await d.chat.react(row.channel_id, id, emoji);
      reacted.add(norm(emoji));
      d.store.set(id, { reacted: JSON.stringify([...reacted]) });
    };
    await this.safe("react ✅", () => react(ACK)); // first, before anything slow
    const thread = this.safe("thread", async () => {
      const cur = d.store.get(id)!;
      if (cur.reply_id) return;
      let threadId = cur.thread_id;
      if (!threadId) { threadId = await d.chat.startThread(row.channel_id, id, threadName(text ?? storedText(cur))); d.store.set(id, { thread_id: threadId }); }
      const replyId = await d.chat.send(threadId, REPLY_WORKING);
      d.store.set(id, { reply_id: replyId, reply_text: REPLY_WORKING });
    });
    const rest = (async () => { for (const e of ROUTING) await this.safe(`react ${e}`, () => react(e)); })();
    await Promise.all([thread, rest]);
  }

  private async say(id: string, text: string): Promise<void> {
    const d = this.d;
    let row = d.store.get(id)!;
    if (row.reply_text === text && row.reply_id) return;
    await this.safe("reply", async () => {
      if (!row.reply_id) { await this.ensureAck(id); row = d.store.get(id)!; }
      if (!row.reply_id || !row.thread_id) return;
      if (row.reply_text !== text) await d.chat.edit(row.thread_id, row.reply_id, text);
      d.store.set(id, { reply_text: text });
    });
  }

  // ---- parsing ----

  private async process(id: string, live?: IncomingMessage): Promise<void> {
    const d = this.d;
    const row = d.store.get(id);
    if (!row) return;
    if (d.store.tapped(id).has("❌")) return this.reconcile(id);
    if (row.parsed) return this.reconcile(id);
    if (!d.parser) {
      d.store.set(id, { status: "queued" });
      return this.say(id, REPLY_QUEUED);
    }
    const msg = live ?? (await d.chat.fetchMessage(row.channel_id, id).catch(() => null)) ?? fromStored(row);
    if (!msg) { d.store.set(id, { status: "manual" }); return this.say(id, "Could not read this post, left for the planner run"); }
    try {
      const raw = await d.parser.parse({ content: msg.content, embeds: msg.embeds, images: msg.images, nowIso: new Date(d.now()).toISOString() });
      const text = `${msg.content}\n${msg.embeds.map((e) => `${e.title ?? ""} ${e.description ?? ""}`).join("\n")}`;
      const forced = looksPrivate(text);
      const items = raw.map((i) => ({ ...i, forcedPrivate: i.forcedPrivate || forced }));
      d.store.set(id, { parsed: JSON.stringify(items), attempts: 0, last_error: "" });
    } catch (e) {
      const err = e as Error;
      const pe = e instanceof ParseError ? e : null;
      const attempts = row.attempts + 1;
      d.log(`parse failed for ${id} (attempt ${attempts}): ${err.message}`);
      if (pe?.refusal || (pe && !pe.retryable) || attempts >= d.maxAttempts) {
        d.store.set(id, { status: "manual", attempts, last_error: err.message.slice(0, 300) });
        await this.say(id, pe?.refusal ? "I could not read this one, left for the planner run" : "Could not parse this after several tries, left for the planner run");
      } else {
        d.store.set(id, { status: "failed", attempts, last_error: err.message.slice(0, 300), next_try_ms: d.now() + Math.min(60, 5 * 2 ** (attempts - 1)) * 60_000 });
        await this.say(id, "Could not parse this yet, will retry");
      }
      return;
    }
    // The parse is saved. If the API is down, keep the parse and try again soon; never re-spend the model call.
    try { await this.reconcile(id); } catch (e) {
      d.log(`filing ${id} failed: ${(e as Error).message}`);
      d.store.set(id, { status: "failed", last_error: (e as Error).message.slice(0, 300), next_try_ms: d.now() + 60_000 });
    }
  }

  // ---- applying the owner's taps to the parse result ----

  private async reconcile(id: string): Promise<void> {
    const d = this.d;
    let row = d.store.get(id);
    if (!row) return;
    const T = d.store.tapped(id);
    const reacted = new Set<string>(JSON.parse(row.reacted) as string[]);
    const setReacted = (): void => d.store.set(id, { reacted: JSON.stringify([...reacted]) });

    if (T.has("❌")) {
      let filed = JSON.parse(row.filed) as FiledRef[];
      if (filed.length || !row.removed_applied) {
        const known = new Set(filed.map((f) => f.id));
        const extra = (await d.api.byMessage(id)).filter((i) => !known.has(i.id)).map((i): FiledRef => ({ key: "", kind: i.kind, id: i.id, name: i.name, priv: i.private }));
        for (const f of [...filed, ...extra]) { await d.api.remove(f.kind, f.id); }
        filed = [];
        d.store.set(id, { filed: "[]" });
      }
      d.store.set(id, { status: "removed", removed_applied: 1 });
      if (!reacted.has(norm(TRASH))) { await this.safe("react 🗑️", async () => { await d.chat.react(row!.channel_id, id, TRASH); reacted.add(norm(TRASH)); setReacted(); }); }
      return this.say(id, "Removed from the site. Take the ❌ off to bring it back.");
    }

    if (row.removed_applied) { // undo
      await this.safe("unreact 🗑️", async () => { await d.chat.unreact(row!.channel_id, id, TRASH); });
      reacted.delete(norm(TRASH)); setReacted();
      d.store.set(id, { removed_applied: 0, status: row.parsed ? "filed" : d.parser ? "received" : "queued" });
      row = d.store.get(id)!;
    }
    if (!row.parsed) return; // not parsed yet: nothing to apply; process() or the sweep will parse it

    const items = JSON.parse(row.parsed) as ParsedItem[];
    const { outs: want, notes } = plan(items, T);
    const lines: string[] = [...notes];

    let filed = JSON.parse(row.filed) as FiledRef[];
    const save = (): void => d.store.set(id, { filed: JSON.stringify(filed) });
    if (want.some((w) => !filed.find((f) => f.key === w.key))) {
      // Crash recovery: adopt what the API already holds for this message before creating anything.
      const existing = await d.api.byMessage(id);
      for (const w of want) {
        if (filed.find((f) => f.key === w.key)) continue;
        const hit = existing.find((x) => x.kind === w.kind && x.name === w.item.name && x.private === w.priv && !filed.some((f) => f.id === x.id));
        if (hit) filed.push({ key: w.key, kind: w.kind, id: hit.id, name: hit.name, priv: hit.private });
      }
      save();
    }
    for (const f of [...filed]) {
      if (want.some((w) => w.key === f.key)) continue;
      await d.api.remove(f.kind, f.id);
      filed = filed.filter((x) => x !== f); save();
    }
    for (const w of want) {
      const ref = filed.find((f) => f.key === w.key);
      if (ref) {
        if (ref.priv !== w.priv) { await d.api.patchPrivate(ref.kind, ref.id, w.priv); ref.priv = w.priv; save(); }
      } else {
        const fields = w.kind === "place"
          ? { name: w.item.name, lat: w.item.lat, lng: w.item.lng, category: categoryId(w.item.category), note: "", url: w.item.url, private: w.priv, msg_id: id, source: "discord" }
          : { title: w.item.name, venue: w.item.venue, city: w.item.city, start: startOf(w.item), url: w.item.url, private: w.priv, msg_id: id, source: "discord" };
        const newId = await d.api.create(w.kind, fields);
        filed.push({ key: w.key, kind: w.kind, id: newId, name: w.item.name, priv: w.priv }); save();
      }
    }
    let estimate = false;
    for (const w of [...want].reverse()) {
      lines.unshift(`${DEST_ICON[w.dest]} ${w.item.name}${w.kind === "place" && label(w.item.category) ? ` (${label(w.item.category)})` : w.kind === "event" ? " (Event)" : ""}: ${destText(w)}`);
      if (w.kind === "place" && !w.priv) estimate = true;
    }
    if (estimate) lines.push("Pins come from the AI and may be a bit off. Tap ❌ to remove.");
    d.store.set(id, { status: want.length || notes.some((n) => n.startsWith("💭")) ? "filed" : "manual" });
    await this.say(id, lines.join("\n") || "Nothing to file here, left for the planner run");
  }

  // ---- the periodic pass: catches whatever the gateway missed, idempotently ----

  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    const d = this.d;
    try {
      // 1. messages posted while offline or during a gateway gap
      let cursor = d.store.kv("last_id");
      if (!cursor) {
        cursor = (await d.chat.latestId(d.channelId)) ?? "0";
        d.store.setKv("last_id", cursor); // first run: do not backfill old history
      } else {
        for (;;) {
          const batch = await d.chat.fetchSince(d.channelId, cursor);
          if (!batch.length) break;
          for (const m of batch) { await this.onMessage(m); if (cmpId(m.id, cursor) > 0) cursor = m.id; }
          d.store.setKv("last_id", cursor);
          if (batch.length < 100) break;
        }
      }
      // 2. reactions tapped while the bot was down (or dropped by a reconnect), last N days
      for (const row of d.store.recent(d.now() - d.windowMs)) {
        await this.safe(`reactions ${row.id}`, async () => {
          const now = await d.chat.tappedEmojis(row.channel_id, row.id, d.ownerId);
          if (!now) return;
          const want = new Set(now.map(norm).filter((e) => ROUTING_SET.has(e)));
          const have = d.store.tapped(row.id);
          const same = want.size === have.size && [...want].every((e) => have.has(e));
          if (same) return;
          for (const e of have) if (!want.has(e)) d.store.setTapped(row.id, e, false);
          for (const e of want) if (!have.has(e)) d.store.setTapped(row.id, e, true);
          await this.lock(row.id, () => this.reconcile(row.id));
        });
      }
      // 2b. posts whose acknowledgement (reactions or thread reply) never finished
      for (const row of d.store.recent(d.now() - d.windowMs)) {
        if (row.status === "received" || row.status === "failed") continue; // step 3 handles these
        const done = row.reply_id && (JSON.parse(row.reacted) as string[]).length >= ROUTING.length + 1;
        if (done) continue;
        await this.safe(`ack ${row.id}`, () => this.lock(row.id, async () => {
          await this.ensureAck(row.id);
          if (d.store.get(row.id)!.parsed) await this.reconcile(row.id);
          else if (row.status === "queued" && !d.parser) await this.say(row.id, REPLY_QUEUED);
        }));
      }
      // 3. the parse queue: stuck posts, retries that are due, and queued posts once a key exists
      const stuck = d.store.byStatus("received").filter((r) => r.created_ms < d.now() - 30_000);
      const failed = d.store.byStatus("failed").filter((r) => r.next_try_ms <= d.now());
      const queued = d.parser ? d.store.byStatus("queued") : [];
      for (const row of [...stuck, ...failed, ...queued]) {
        await this.safe(`queue ${row.id}`, () => this.lock(row.id, async () => {
          const cur = d.store.get(row.id);
          if (!cur || cur.status === "filed" || cur.status === "manual" || cur.status === "removed") return;
          await this.ensureAck(row.id);
          await this.process(row.id);
        }));
      }
    } finally { this.sweeping = false; }
  }
}

function storedText(row: Row): string { try { return (JSON.parse(row.content) as { content?: string }).content ?? ""; } catch { return ""; } }
function fromStored(row: Row): IncomingMessage | null {
  try {
    const c = JSON.parse(row.content) as { content: string; embeds: IncomingMessage["embeds"]; images: string[] };
    return { id: row.id, channelId: row.channel_id, authorId: "", authorBot: false, system: false, content: c.content, embeds: c.embeds ?? [], images: c.images ?? [], createdMs: row.created_ms };
  } catch { return null; }
}
/** Thread names are plain text: no mentions, no links, short. */
export function threadName(text: string): string {
  const t = text.replace(/<[@#&!][^>]*>/g, "").replace(/https?:\/\/\S+/g, "").replace(/@/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return t || "Planner post";
}

export type Dest = "auto" | "cal" | "ev" | "evq" | "pl" | "idea";
export interface Out { key: string; kind: "place" | "event"; item: ParsedItem; priv: boolean; dest: Dest }
const DEST_ICON: Record<Dest, string> = { auto: "📌", cal: "📅", ev: "🎟️", evq: "❓", pl: "📍", idea: "💭" };
function destText(w: Out): string {
  if (w.dest === "cal") return "private calendar item, not on the site";
  if (w.dest === "idea") return "private idea, not on the site";
  if (w.dest === "evq") return "not clearly an event, kept private";
  return w.priv ? "private, not on the site" : w.kind === "event" ? "public event listing" : "live on the site";
}

/**
 * The destination matrix. Taps among 📅 🎟️ 📍 💭 pick the destinations exactly; with none tapped the automatic choice stands
 * (by kind, public when the model says public and the privacy rules pass). Destinations:
 *   📅 private calendar item (always private)    🎟️ public event listing    📍 public place    💭 private idea (additive)
 * 🔒 forces every output private. forcedPrivate (bot's text rules) and the model's own public:false also keep public outputs private.
 * Pure: exported for tests.
 */
export function plan(items: ParsedItem[], T: Set<string>): { outs: Out[]; notes: string[] } {
  const outs: Out[] = []; const notes: string[] = [];
  const cal = T.has("📅"), ev = T.has(norm("🎟️")), pl = T.has("📍"), idea = T.has("💭"), lock = T.has("🔒");
  const anyDest = cal || ev || pl || idea;
  items.forEach((item, idx) => {
    const name = item.name || "(no name)";
    const noPublic = item.forcedPrivate || !item.public || lock;
    const placeOk = item.lat !== null && item.lng !== null && !!categoryId(item.category);
    const eventOk = !!item.date;
    const add = (dest: Dest, kind: "place" | "event", priv: boolean): void => { outs.push({ key: `${idx}:${dest}`, kind, item, priv, dest }); };
    if (!anyDest) {
      if (item.kind === "unclear") notes.push(`❔ ${name}: not sure what this is, left for the planner run`);
      else if (item.kind === "place") placeOk ? add("auto", "place", noPublic) : notes.push(`📍 ${name}: needs a pin, left for the planner run`);
      else eventOk ? add("auto", "event", noPublic) : notes.push(`📅 ${name}: needs a date, left for the planner run`);
      return;
    }
    if (cal) eventOk ? add("cal", "event", true) : notes.push(`📅 ${name}: needs a date for the calendar, left for the planner run`);
    if (ev) {
      if (eventOk) add("ev", "event", noPublic);
      else {
        notes.push(`❓ ${name}: not clearly an event, kept private`);
        if (placeOk && !pl) add("evq", "place", true);
      }
    }
    if (pl) placeOk ? add("pl", "place", noPublic) : notes.push(`📍 ${name}: needs a pin, left for the planner run`);
    if (idea) {
      const dup = pl && placeOk && noPublic; // 📍 already produced a private copy
      if (placeOk) { if (!dup) add("idea", "place", true); }
      else if (eventOk) add("idea", "event", true);
      else notes.push(`💭 ${name}: kept as an idea (nothing to pin or date)`);
    }
  });
  return { outs, notes };
}
