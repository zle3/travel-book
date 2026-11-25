import { DatabaseSync } from "node:sqlite";

export type Status = "received" | "queued" | "filed" | "manual" | "failed" | "removed";
export interface FiledRef { key: string; kind: "place" | "event"; id: string; name: string; priv: boolean }
export interface Row {
  id: string; channel_id: string; created_ms: number; status: Status;
  thread_id: string | null; reply_id: string | null; reply_text: string;
  attempts: number; next_try_ms: number; last_error: string;
  content: string; parsed: string | null; reacted: string; filed: string; removed_applied: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, created_ms INTEGER NOT NULL, status TEXT NOT NULL,
  thread_id TEXT, reply_id TEXT, reply_text TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0, next_try_ms INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '', parsed TEXT, reacted TEXT NOT NULL DEFAULT '[]', filed TEXT NOT NULL DEFAULT '[]',
  removed_applied INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS messages_created ON messages(created_ms);
CREATE TABLE IF NOT EXISTS tapped (message_id TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY (message_id, emoji));
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export class Store {
  readonly sql: DatabaseSync;
  constructor(path: string) {
    this.sql = new DatabaseSync(path);
    this.sql.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;");
    this.sql.exec(SCHEMA);
  }
  close(): void { this.sql.close(); }

  get(id: string): Row | undefined { return this.sql.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Row | undefined; }
  insert(r: { id: string; channelId: string; createdMs: number; content: string; status: Status }): boolean {
    return Number(this.sql.prepare("INSERT OR IGNORE INTO messages(id, channel_id, created_ms, status, content) VALUES(?,?,?,?,?)").run(r.id, r.channelId, r.createdMs, r.status, r.content).changes) > 0;
  }
  set(id: string, f: Partial<Omit<Row, "id">>): void {
    const cols = Object.keys(f);
    if (cols.length) this.sql.prepare(`UPDATE messages SET ${cols.map((c) => `${c}=?`).join(",")} WHERE id=?`).run(...(cols.map((c) => (f as Record<string, unknown>)[c]) as never[]), id);
  }
  recent(sinceMs: number): Row[] { return this.sql.prepare("SELECT * FROM messages WHERE created_ms >= ? ORDER BY created_ms").all(sinceMs) as unknown as Row[]; }
  byStatus(status: Status): Row[] { return this.sql.prepare("SELECT * FROM messages WHERE status = ? ORDER BY created_ms").all(status) as unknown as Row[]; }

  tapped(id: string): Set<string> { return new Set((this.sql.prepare("SELECT emoji FROM tapped WHERE message_id = ?").all(id) as Array<{ emoji: string }>).map((r) => r.emoji)); }
  setTapped(id: string, emoji: string, on: boolean): void {
    if (on) this.sql.prepare("INSERT OR IGNORE INTO tapped(message_id, emoji) VALUES(?,?)").run(id, emoji);
    else this.sql.prepare("DELETE FROM tapped WHERE message_id = ? AND emoji = ?").run(id, emoji);
  }
  kv(key: string): string | null { return (this.sql.prepare("SELECT value FROM kv WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null; }
  setKv(key: string, value: string): void { this.sql.prepare("INSERT INTO kv(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value); }
}
