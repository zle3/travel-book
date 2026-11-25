import type { Api, ApiItemRef } from "./types.ts";

const path = (k: "place" | "event"): string => (k === "place" ? "places" : "events");

export class HttpApi implements Api {
  private base: string; private token: string; private f: typeof fetch;
  constructor(base: string, token: string, f: typeof fetch = fetch) { this.base = base; this.token = token; this.f = f; }
  private async call(method: string, p: string, body?: unknown): Promise<unknown> {
    const r = await this.f(`${this.base}/v1/admin/${p}`, {
      method, signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${this.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok && !(method === "DELETE" && r.status === 404)) throw new Error(`API ${method} ${p} answered ${r.status}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  }
  async create(kind: "place" | "event", fields: Record<string, unknown>): Promise<string> {
    return ((await this.call("POST", path(kind), fields)) as { id: string }).id;
  }
  async patchPrivate(kind: "place" | "event", id: string, priv: boolean): Promise<void> { await this.call("PATCH", `${path(kind)}/${id}`, { private: priv }); }
  async remove(kind: "place" | "event", id: string): Promise<void> { await this.call("DELETE", `${path(kind)}/${id}`); }
  async byMessage(messageId: string): Promise<ApiItemRef[]> {
    const j = (await this.call("GET", `messages/${messageId}`)) as { places: Array<{ id: string; name: string; private: boolean }>; events: Array<{ id: string; title: string; private: boolean }> };
    return [
      ...j.places.map((p): ApiItemRef => ({ kind: "place", id: p.id, name: p.name, private: p.private })),
      ...j.events.map((e): ApiItemRef => ({ kind: "event", id: e.id, name: e.title, private: e.private })),
    ];
  }
}
