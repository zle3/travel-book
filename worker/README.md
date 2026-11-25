# Edge worker: API routes, bot policy and (optional) password gate

**This project runs with the gate off** (`GATE_DISABLED=1` in `wrangler.jsonc`, owner decision 2026-11-24, see PRODUCT.md): the site is public, bot blocking, `robots.txt` and `noindex` stay on. Past the gate step the Worker serves `/api/*` (`worker/api.ts`: 19hz shows, Open-Meteo weather, NWS alerts, backend health and live proxy, documented in `docs/ROUTES.md`) and otherwise the static assets, adding long cache headers to the bulk data files. The rest of this file describes the gate, which is still in the code and tested.

`worker/index.ts` runs first for every request (Workers static assets, `run_worker_first`). Dependency-free; wrangler bundles it. Tests: `node scripts/test/gate.test.mjs` (stubbed DNS, no network).

## Request flow
1. `GET /robots.txt`: served by the worker, always public (even to blocked bots). Search indexing is off by default: `User-agent: *` and every AI/agent token in `bots.ts` (plus the robots-only tokens Google-Extended and Applebot-Extended) get `Disallow: /`, and there is no Sitemap line. It overrides `public/robots.txt`; **keep `public/robots.txt` identical** so a static deploy without the worker agrees.
2. Verified search engines (Googlebot, Google-InspectionTool, Bingbot, Bingpreview, Applebot) bypass the gate only when `GATE_ALLOW_SEARCH` is exactly `"1"`. The default (unset, and `"0"` in `wrangler.jsonc`) is OFF, so they get the gate. Never by User-Agent alone: the client IP (`CF-Connecting-IP`) is reverse-resolved (DNS-over-HTTPS, Cloudflare `application/dns-json`) and the PTR name must end in the engine's official domain (`googlebot.com`/`google.com`, `search.msn.com`, `applebot.apple.com`), then that hostname is forward-resolved and must contain the same IP. Results are cached for a day (Cache API, keyed by engine + IP); a DNS error fails closed and is cached 5 minutes. DuckDuckBot is not supported (no reverse-DNS documentation). The bypass code stays in place but is off unless the owner turns it on.
3. AI crawlers, generic scrapers and empty User-Agents get `403` (list in `worker/bots.ts`). This runs before the gate and stays on after launch.
4. Password gate: no valid `kotone_gate` cookie gives a self-contained `401` page (`Cache-Control: no-store`). `POST /__gate` (fields `password`, `next`) compares SHA-256 digests (constant time). Success sets `kotone_gate=<expiry>.<HMAC-SHA256>` (HttpOnly; Secure; SameSite=Lax; Path=/; 30 days) and 303-redirects to `next` (same-origin relative path only, else `/`). Failure waits 600 ms and re-renders with an error. `GET /__logout` clears the cookie.
5. Valid cookie: `env.ASSETS.fetch(request)`.

Every response (gate, 403, robots.txt, assets, redirects) carries `X-Robots-Tag: noindex, nofollow, noarchive`, and the gate page has `<meta name="robots" content="noindex, nofollow">`.

## Per-site wording
`worker/site-config.ts` holds the link-preview metadata (title, description, image alt, site name), the credit box on the password page, and theme colours. It is the only worker file that differs between sites; `kotone-new` fills its placeholders. `rebuild` mode produces the "unofficial concept redesign" wording; `new` mode a neutral "private preview". The preview image path must also stay in `PUBLIC_PATHS` in `index.ts` (a test checks it).

## Public icon allow-list
`PUBLIC_PATHS` in `index.ts` is an exact-match set (favicons, apple-touch icon, manifest, preview card). Never a prefix; GET/HEAD only. Files must exist in `public/` or the worker passes the 404 through uncached.

Fail closed: if `SITE_PASSWORD` is unset the gate shows "not configured" (no cookie or crawler bypass applies), unless `GATE_DISABLED=1`.

Rate limit: 10 failed attempts per IP per 10 minutes, then `429`. The counter is in memory per isolate, so it is best effort (not shared across isolates or locations); the 600 ms delay and a strong password are the real defence.

Limits to know: the bot list is a deterrent only. A scraper that sends a browser User-Agent is stopped by the password gate, not by the list; after launch it is not stopped at all.

## Setup and secrets
`wrangler.jsonc` already has `main`, the `ASSETS` binding and `run_worker_first: true` (required, otherwise matching static files are served without the worker). Secrets (owner, own terminal, never in chat):
```
npx wrangler secret put SITE_PASSWORD
openssl rand -hex 32 | npx wrangler secret put GATE_SECRET
```
`GATE_SECRET` signs session cookies. If absent, the key is derived from `SITE_PASSWORD`. Rotating either signs everyone out. Local dev: `SITE_PASSWORD=...` and `GATE_SECRET=...` in `.dev.vars` (gitignored).

## The gate is permanent by default
`GATE_DISABLED=1` exists in the code (it opens the whole site), but a new project does not use it. Turning the gate off is an owner decision recorded in `ops/OPERATIONS.md`; agents never set it.
