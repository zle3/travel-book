/**
 * Bot policy lists. Matching is case-insensitive substring on the User-Agent.
 * Verified search engines (worker/verify.ts) are checked first and win over BLOCKED_UA.
 */

/** AI / agent crawlers that send their own User-Agent. Blocked with 403, also listed in robots.txt. */
export const AI_CRAWLERS: string[] = [
  "GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot", "Claude-Web", "anthropic-ai",
  "Claude-User", "Claude-SearchBot", "CCBot", "PerplexityBot", "Perplexity-User", "Bytespider",
  "Amazonbot", "meta-externalagent", "meta-externalfetcher", "FacebookBot", "cohere-ai", "Diffbot",
  "ImagesiftBot", "Omgilibot", "YouBot", "Timpibot", "PetalBot", "DataForSeoBot", "AhrefsBot",
  "SemrushBot", "MJ12bot",
];

/** robots.txt-only tokens: never appear in a User-Agent, so they can only be handled in robots.txt. */
export const ROBOTS_ONLY_TOKENS: string[] = ["Google-Extended", "Applebot-Extended"];

/** Generic HTTP clients / headless browsers. */
export const GENERIC_SCRAPERS: string[] = [
  "python-requests", "aiohttp", "httpx", "curl", "wget", "Go-http-client", "Java/", "okhttp",
  "Scrapy", "node-fetch", "axios", "HeadlessChrome", "PhantomJS",
];

const BLOCKED_LOWER = [...AI_CRAWLERS, ...GENERIC_SCRAPERS].map((s) => s.toLowerCase());

/** True for an empty User-Agent or one containing any blocked token. */
export function isBlockedUA(ua: string | null | undefined): boolean {
  const u = (ua ?? "").trim().toLowerCase();
  if (!u) return true;
  return BLOCKED_LOWER.some((t) => u.includes(t));
}

/**
 * robots.txt. Search indexing is off for this site (owner decision): everything is disallowed,
 * for every crawler. The AI-crawler groups stay explicit. Same text as public/robots.txt.
 */
export function robotsTxt(): string {
  const tokens = [...AI_CRAWLERS, ...ROBOTS_ONLY_TOKENS];
  return [
    "User-agent: *",
    "Disallow: /",
    "",
    ...tokens.map((t) => `User-agent: ${t}`),
    "Disallow: /",
    "",
  ].join("\n");
}
