import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

export interface PlaceRow { id: string; name: string; lat: number; lng: number; category: string; note: string; url: string; private: number; source: string; msg_id: string | null; added: string; updated: string }
export interface EventRow { id: string; title: string; venue: string; city: string; start: string; end: string; url: string; private: number; source: string; msg_id: string | null; added: string; updated: string }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS places (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'other', note TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'discord', msg_id TEXT,
  added TEXT NOT NULL, updated TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, venue TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
  start TEXT NOT NULL, end TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
  private INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'discord', msg_id TEXT,
  added TEXT NOT NULL, updated TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS places_msg ON places(msg_id);
CREATE INDEX IF NOT EXISTS events_msg ON events(msg_id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export type Kind = "places" | "events";

export class Db {
  readonly sql: DatabaseSync;
  constructor(path: string) {
    this.sql = new DatabaseSync(path);
    this.sql.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
    this.sql.exec(SCHEMA);
  }
  close(): void { this.sql.close(); }

  static newId(): string { return randomBytes(6).toString("hex"); }

  private touch(): void {
    this.sql.prepare("INSERT INTO meta(key,value) VALUES('live_updated_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date().toISOString());
  }
  liveUpdatedAt(): string { return (this.sql.prepare("SELECT value FROM meta WHERE key='live_updated_at'").get() as { value: string } | undefined)?.value ?? ""; }

  list(kind: Kind, opts: { publicOnly?: boolean; since?: string } = {}): Array<PlaceRow | EventRow> {
    const where: string[] = []; const args: string[] = [];
    if (opts.publicOnly) where.push("private = 0");
    if (opts.since) { where.push("updated >= ?"); args.push(opts.since); }
    const order = kind === "places" ? "added" : "start";
    return this.sql.prepare(`SELECT * FROM ${kind} ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order}, id`).all(...args) as never;
  }
  get(kind: Kind, id: string): PlaceRow | EventRow | undefined {
    return this.sql.prepare(`SELECT * FROM ${kind} WHERE id = ?`).get(id) as never;
  }
  insert(kind: Kind, f: Record<string, unknown>): string {
    const id = Db.newId(); const now = new Date().toISOString();
    const row = { id, source: "discord", msg_id: null, ...(kind === "places" ? { note: "" } : {}), url: "", private: 0, added: now, updated: now, ...f } as Record<string, unknown>;
    const cols = Object.keys(row);
    this.sql.prepare(`INSERT INTO ${kind}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`).run(...(cols.map((c) => row[c]) as never[]));
    this.touch();
    return id;
  }
  update(kind: Kind, id: string, f: Record<string, unknown>): boolean {
    const cols = Object.keys(f);
    if (!cols.length) return !!this.get(kind, id);
    const r = this.sql.prepare(`UPDATE ${kind} SET ${cols.map((c) => `${c}=?`).join(",")}, updated=? WHERE id=?`).run(...(cols.map((c) => f[c]) as never[]), new Date().toISOString(), id);
    if (r.changes) this.touch();
    return r.changes > 0;
  }
  remove(kind: Kind, id: string): boolean {
    const r = this.sql.prepare(`DELETE FROM ${kind} WHERE id = ?`).run(id);
    if (r.changes) this.touch();
    return r.changes > 0;
  }
  /** All items filed from one Discord message. */
  byMessage(msg: string): { places: PlaceRow[]; events: EventRow[] } {
    return {
      places: this.sql.prepare("SELECT * FROM places WHERE msg_id = ?").all(msg) as never,
      events: this.sql.prepare("SELECT * FROM events WHERE msg_id = ?").all(msg) as never,
    };
  }
  deleteByMessage(msg: string): number {
    let n = 0;
    for (const k of ["places", "events"] as const) n += Number(this.sql.prepare(`DELETE FROM ${k} WHERE msg_id = ?`).run(msg).changes);
    if (n) this.touch();
    return n;
  }
  setPrivateByMessage(msg: string, priv: boolean): number {
    let n = 0; const now = new Date().toISOString();
    for (const k of ["places", "events"] as const) n += Number(this.sql.prepare(`UPDATE ${k} SET private = ?, updated = ? WHERE msg_id = ? AND private != ?`).run(priv ? 1 : 0, now, msg, priv ? 1 : 0).changes);
    if (n) this.touch();
    return n;
  }
}
