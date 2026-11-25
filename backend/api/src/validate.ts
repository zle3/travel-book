import { categoryId } from "./categories.ts";
import type { Kind } from "./db.ts";

type Obj = Record<string, unknown>;
export type Checked = { ok: true; fields: Obj } | { ok: false; error: string };

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.trim().slice(0, max) : null);
const httpUrl = (v: unknown): string | null => {
  const s = str(v, 500);
  return s !== null && (s === "" || /^https?:\/\/\S+$/i.test(s)) ? s : null;
};
const isoDate = (v: unknown): string | null => {
  const s = str(v, 40);
  return s !== null && /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s) ? s : null;
};

/** Validates a create (partial=false) or patch (partial=true) body. Unknown fields are rejected, never stored. */
export function check(kind: Kind, body: unknown, partial: boolean): Checked {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const b = body as Obj; const out: Obj = {};
  const required = kind === "places" ? ["name", "lat", "lng"] : ["title", "start"];
  const allowed = new Set([...(kind === "places" ? ["name", "lat", "lng", "category", "note"] : ["title", "venue", "city", "start", "end"]), "url", "private", "source", "msg_id"]);
  for (const k of Object.keys(b)) if (!allowed.has(k)) return { ok: false, error: `unknown field: ${k}` };
  if (!partial) for (const k of required) if (b[k] === undefined) return { ok: false, error: `missing field: ${k}` };
  for (const [k, v] of Object.entries(b)) {
    let r: unknown;
    switch (k) {
      case "name": r = str(v, 120); if (r === "") r = null; break;
      case "title": r = str(v, 160); if (r === "") r = null; break;
      case "note": r = str(v, 300); break;
      case "venue": r = str(v, 120); break;
      case "city": r = str(v, 80); break;
      case "url": r = httpUrl(v); break;
      case "lat": r = typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 90 ? v : null; break;
      case "lng": r = typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 180 ? v : null; break;
      case "category": r = categoryId(v); break;
      case "start": r = isoDate(v); break;
      case "end": r = v === "" ? "" : isoDate(v); break;
      case "private": r = typeof v === "boolean" ? (v ? 1 : 0) : v === 0 || v === 1 ? v : null; break;
      case "source": r = str(v, 20); if (r === "") r = null; break;
      case "msg_id": r = v === null ? null : str(v, 32); break;
    }
    if (r === null && !(k === "msg_id" && v === null)) return { ok: false, error: `invalid field: ${k}` };
    out[k] = r;
  }
  if (kind === "places" && !partial && out.category === undefined) out.category = "other";
  return { ok: true, fields: out };
}
