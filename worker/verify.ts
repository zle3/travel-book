/**
 * Verified search-engine crawlers (forward-confirmed reverse DNS, per each engine's documentation).
 * A User-Agent alone is never trusted: the client IP must reverse-resolve to the engine's official
 * domain and that hostname must forward-resolve back to the same IP. Any DNS error fails closed.
 * DuckDuckBot is intentionally absent: DuckDuckGo publishes IP lists, not reverse-DNS names.
 */

export type RecordType = "PTR" | "A" | "AAAA";
/** Returns the record data strings; throws on resolver failure. */
export type Resolver = (name: string, type: RecordType) => Promise<string[]>;

export interface CacheLike {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}

interface Engine { name: string; ua: RegExp; domains: string[] }

export const ENGINES: Engine[] = [
  { name: "google", ua: /googlebot|google-inspectiontool/i, domains: ["googlebot.com", "google.com"] },
  { name: "bing", ua: /bingbot|bingpreview/i, domains: ["search.msn.com"] },
  { name: "apple", ua: /applebot/i, domains: ["applebot.apple.com"] },
];

const TYPE_CODE: Record<RecordType, number> = { PTR: 12, A: 1, AAAA: 28 };
const POSITIVE_TTL = 86400;
const NEGATIVE_TTL = 86400;
const ERROR_TTL = 300;

/** DNS-over-HTTPS resolver (Cloudflare, application/dns-json). */
export const dohResolver: Resolver = async (name, type) => {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetch(url, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`doh ${res.status}`);
  const body = (await res.json()) as { Status?: number; Answer?: { type: number; data: string }[] };
  if (body.Status === 3) return []; // NXDOMAIN
  if (body.Status !== 0) throw new Error(`doh status ${body.Status}`);
  return (body.Answer ?? []).filter((a) => a.type === TYPE_CODE[type]).map((a) => a.data);
};

/** Canonical form of an IPv4 or IPv6 address (IPv6 expanded to 8 x 4 hex digits), or null. */
export function normalizeIp(raw: string): string | null {
  const ip = raw.trim().toLowerCase().split("%")[0] ?? "";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const parts = ip.split(".").map(Number);
    return parts.every((n) => n <= 255) ? parts.join(".") : null;
  }
  if (!/^[0-9a-f:]+$/.test(ip) || !ip.includes(":")) return null;
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  } else groups = head;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, "0")).join(":");
}

/** in-addr.arpa / ip6.arpa name for a normalized address. */
export function reverseName(ipn: string): string {
  if (!ipn.includes(":")) return ipn.split(".").reverse().join(".") + ".in-addr.arpa";
  return ipn.replace(/:/g, "").split("").reverse().join(".") + ".ip6.arpa";
}

const memory = new Map<string, { v: boolean; exp: number }>();
const memoryCache = (now: () => number): CacheLike => ({
  async match(req) {
    const e = memory.get(req.url);
    if (!e || e.exp < now()) return undefined;
    return new Response(e.v ? "1" : "0");
  },
  async put(req, res) {
    const ttl = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") ?? "")?.[1] ?? 0);
    if (memory.size > 5000) memory.clear();
    memory.set(req.url, { v: (await res.text()) === "1", exp: now() + ttl * 1000 });
  },
});

export function defaultCache(now: () => number): CacheLike {
  const c = (globalThis as { caches?: { default?: CacheLike } }).caches?.default;
  return c ?? memoryCache(now);
}

export interface VerifyDeps { resolve: Resolver; cache: CacheLike }

/** True only if `ua` claims a supported engine AND `ip` passes forward-confirmed reverse DNS for it. */
export async function verifyCrawler(ip: string | null, ua: string, deps: VerifyDeps): Promise<boolean> {
  const engine = ENGINES.find((e) => e.ua.test(ua));
  if (!engine || !ip) return false;
  const ipn = normalizeIp(ip);
  if (!ipn) return false;
  const key = new Request(`https://gate-cache.invalid/crawler/${engine.name}/${ipn}`);
  const hit = await deps.cache.match(key);
  if (hit) return (await hit.text()) === "1";

  let ok = false;
  let ttl = NEGATIVE_TTL;
  try {
    const hosts = await deps.resolve(reverseName(ipn), "PTR");
    for (const raw of hosts.slice(0, 5)) {
      const host = raw.toLowerCase().replace(/\.$/, "");
      if (!engine.domains.some((d) => host === d || host.endsWith("." + d))) continue;
      const addrs = await deps.resolve(host, ipn.includes(":") ? "AAAA" : "A");
      if (addrs.some((a) => normalizeIp(a) === ipn)) { ok = true; ttl = POSITIVE_TTL; break; }
    }
  } catch {
    ok = false;
    ttl = ERROR_TTL;
  }
  await deps.cache.put(key, new Response(ok ? "1" : "0", { headers: { "cache-control": `max-age=${ttl}` } }));
  return ok;
}
