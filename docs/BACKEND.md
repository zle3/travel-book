# Home backend (api, bot, tiles, tunnel)

One Dockge stack at `backend/` (`compose.yaml`, `env.example`). Contract the site relies on: `docs/ROUTES.md` ("Home backend contract"). No Cloudflare D1/KV/R2, no ports published on the host: everything reaches the internet through the Cloudflare Tunnel.

```
 browser ──> Worker (/api/live, /api/health, X-Travel-Proxy) ──┐
 browser ──> api.travel.zachle.info/v1/tiles/* (direct) ───────┤  Cloudflare Tunnel
                                                               v
                                         cloudflared ──> api:8787 ──> tiles:8080 (go-pmtiles)
 Discord gateway <──> bot ── Bearer ADMIN_TOKEN ──> api:8787/v1/admin/*   api: SQLite (WAL) on volume api_data
                       bot: own SQLite on volume bot_data
```

## Services
| Service | What | Image |
|---|---|---|
| `api` | `backend/api`: Node 22, TypeScript run directly (no build step), **no runtime dependencies** (`node:http`, `node:sqlite`). Live data, admin CRUD, tiles proxy. | built from `./api`, base image pinned by digest |
| `bot` | `backend/bot`: discord.js gateway bot, `@anthropic-ai/sdk` for optional AI parsing. | built from `./bot`, base image pinned by digest, deps pinned in `package-lock.json` |
| `tiles` | go-pmtiles serving `./tiles/*.pmtiles`. Internal only. | `protomaps/go-pmtiles:v1.31.2` |
| `cloudflared` | Tunnel to `http://api:8787`. | `cloudflare/cloudflared:2026.11.2` |

The bot writes to the API over HTTP (`/v1/admin/*`), not into the API's SQLite file, so two containers never share a database file. The bot keeps its own small SQLite (`bot_data`): its message ledger, the owner's reaction taps, the parse queue and the catch-up cursor.

## API
| Path | Auth | Notes |
|---|---|---|
| `GET /v1/health` | none | `{ok, version, live_updated_at}`. Also the container healthcheck. Never touches tiles, so a tile problem cannot take the API down. |
| `GET /v1/live` | `X-Travel-Proxy` = `PROXY_SECRET` (constant-time compare; the compose file refuses to start without it) | `{places:[{id,name,lat,lng,category,note,added,source:"discord"}], events:[{id,title,venue,city,start,end,url,added}], updated_at}`. Private items are excluded in the SQL query. `?since=` is accepted and ignored (deletions make deltas unsafe; the set is small). `category` is the site's category id, so the site's `adaptLive` keeps it. |
| `GET /v1/tiles/{tileset}/{z}/{x}/{y}.mvt`, `/v1/tiles/{tileset}.json` | public | Proxy to `tiles:8080`. `Access-Control-Allow-Origin` is always `SITE_ORIGIN` (never echoes another origin), tiles `Cache-Control: public, max-age=2592000, immutable`, TileJSON one hour, misses five minutes. 502 if tiles is down. |
| `GET/POST /v1/admin/places\|events`, `GET/PATCH/DELETE .../{id}` | `Authorization: Bearer ADMIN_TOKEN` | Constant-time compare. Rate limited per client IP (`CF-Connecting-IP` only, set by Cloudflare; `X-Forwarded-For` is never trusted, and without the header the socket address is used): 120 requests/min, and 10 failed logins/min after which even the right token waits. Bodies validated, unknown fields rejected, categories limited to the fixed list. |
| `GET/PATCH/DELETE /v1/admin/messages/{discordMessageId}` | admin | Everything filed from one Discord post: list, `{private: bool}` flip, delete. Used by the bot's taps. |

Items have a `private` flag (admin view returns it as a boolean). Private items stay in the database, never in `/v1/live`.

## Bot behaviour
Intents: Guilds, GuildMessages, MessageContent, GuildMessageReactions. It only looks at `DISCORD_PLANNER_CHANNEL_ID`, and **only posts and taps from `DISCORD_OWNER_ID` count** (required; everyone else is ignored).

**New post.** React ✅ first, then 📅 🎟️ 📍 💭 🔒 ❌. Start a thread on the post and send one message, "Got it, filing…". That message is **edited** with the outcome; the bot posts no further messages.

**No pings.** Every send and edit uses `allowedMentions: {parse: [], repliedUser: false}`, the client default is the same, thread names have mentions and links stripped. Reactions never notify.

**Taps** (add or remove, from the owner only), applied immediately and recorded in `bot_data`. Destinations (owner spec):
| Tap | Destination |
|---|---|
| 📅 Calendar | the owner's plans: a **private** calendar item, always private, never in `/v1/live` (needs a date) |
| 🎟️ Events | the **public** event listing on the site (needs a date). On a place that is not event-like it is flagged ❓ and kept private |
| 📍 Places | **public** place on the map and lists (needs coordinates) |
| 💭 Want to do | a **private** idea, not on the site. Additive: with 📍 you get the public place plus a private copy |
| 🔒 Private | overrides everything public: every copy stays private. Remove it and the public destinations come back |
| ❌ Undo | removes everything filed for the post and the bot reacts 🗑️. Remove ❌ to restore (from the saved parse, no new AI call) and 🗑️ goes away |

If any of 📅 🎟️ 📍 💭 is tapped, the post ends up in **exactly** those destinations (so 📅 + 🎟️ is a private calendar copy plus a public listing; 🔒 + 🎟️ is private). With none tapped, the **automatic choice stands**: by kind, public when the model says `public: true` and the privacy filter passes, otherwise private. The owner chose public-by-default for this channel. The privacy rules (below) still win over a public tap: a post the bot's text rules or the model call private is never published by 🎟️ or 📍, only 🔒 toggling or the owner's planner routine can change that. The matrix lives in `plan()` in `bot/src/planner.ts` and is tested combination by combination.

**Parsing.**
- With `ANTHROPIC_API_KEY`: `client.beta.messages.create` with `output_config.format` (JSON schema, up to 5 items of `{kind place|event|unclear, name, date, time, venue, city, lat, lng, url, category, public}`), screenshots as image blocks (HTTPS URLs), Discord embed text included, `betas: ["server-side-fallback-2026-07-01"]` with `fallbacks: "default"`, and a check of `stop_reason` (refusal is not retried and goes to the planner run). Post text is wrapped as data in the prompt, which tells the model never to follow it. The output is re-validated in code: category from the fixed 25-item list, coordinates in range, `http(s)` URLs only, and anything but an explicit `public: true` is private.
- Without a key: nothing is parsed. The bot still reacts and replies "Queued for the next planner run"; the scheduled cloud routine remains the fallback and files the post.
- Places need coordinates, events need a date. Otherwise the reply says what is missing and the post is left for the planner run (the model's coordinates are estimates; the reply says so, and ❌ removes them).
- **Private rules** (code, on top of the model): tickets, confirmation numbers, bookings, people's names, the owner's own attendance, trip dates, or anything marked private never go public. The model is told this, and a text filter (`src/privacy.ts`) forces private when a post says things like "my tickets", "confirmation number", "I'm going", "my trip", "private". It leans wide: a false positive only keeps something off the site. Items forced private stay private even if 🔒 is removed.
- **Model and cost.** Default `claude-opus-5-5`. Set `ANTHROPIC_MODEL` to choose another (for example a cheaper one); the bot never changes it by itself. One call per post (plus retries on transient errors), no calls for posts tapped ❌ first. Billing is on the owner's Anthropic account.

**The 5-minute pass** (`CHECK_INTERVAL_MIN`, default 5; also right at start and after every gateway resume). Each pass is idempotent:
1. Fetch #planner posts after the saved cursor (catches posts missed while offline or during a reconnect). The very first run only records the newest id and does not backfill history.
2. Re-read the reactions on posts from the last 14 days and apply any change (taps made while the bot was down).
3. Finish unfinished acknowledgements (missing reactions or thread reply), retry failed parses (backoff 5, 10, 20, 40, 60 minutes, 5 attempts, then left for the planner run), retry filings that hit an API outage without parsing again, and parse queued posts once a key is set.

Nothing is done twice: every step (each reaction, the thread, the reply, each API item) is recorded as it happens; a retry checks the API for items already filed for that post (`msg_id`) before creating any; posts are locked per message so the gateway and the pass cannot interleave.

## Environment (`env.example` is the template, `.env` is never committed)
| Variable | Required | Meaning |
|---|---|---|
| `ADMIN_TOKEN` | yes | Bearer token for `/v1/admin/*`, used by the bot and the planner routine |
| `PROXY_SECRET` | yes | Shared with the Worker (`X-Travel-Proxy`). **Also set as a Worker secret** |
| `TUNNEL_TOKEN` | yes | Remote-managed tunnel token (public hostname `api.travel.zachle.info` to `http://api:8787`) |
| `DISCORD_BOT_TOKEN` | yes | Bot token. Message Content Intent must be enabled in the developer portal |
| `DISCORD_PLANNER_CHANNEL_ID` | yes | The #planner channel |
| `DISCORD_OWNER_ID` | yes | The owner's user id; posts and taps from anyone else are ignored |
| `ANTHROPIC_API_KEY` | no | Turns AI parsing on (costs per post) |
| `ANTHROPIC_MODEL` | no | Default `claude-opus-5-5` |
| `CHECK_INTERVAL_MIN` | no | Default 5 |
| `SITE_ORIGIN` | no | CORS origin for tiles, default `https://travel.zachle.info` |

Other bot knobs (defaults are fine): `REACTION_WINDOW_DAYS` (14), `PARSE_MAX_ATTEMPTS` (5), `PLANNER_TZ`. API: `ADMIN_RATE_PER_MIN` (120), `ADMIN_FAIL_PER_MIN` (10).

The unused `PUID`/`PGID` and the old `DISCORD_PUBLIC_KEY`/`DISCORD_TOKEN` placeholders are gone.

## Deploy (Dockge host, `/opt/stacks/travel-backend`)
The owner runs Dockge; the lead deploys over SSH. Order matters for the secret:
1. **Worker first:** `npx wrangler secret put PROXY_SECRET` (the same value goes into `.env`; the stack will not start without it). `/api/live` answers 503 until the Worker and the backend hold the same secret, so set the Worker side first and deploy the backend right after.
2. Back up the interim stack: `cp compose.yaml compose.interim.yaml` and keep the current `.env` and `Caddyfile`.
3. Copy the repo's `backend/` over the stack folder (keep `./tiles/` and `.env`). Add to `.env` the new keys from `env.example` (`ADMIN_TOKEN`, `PROXY_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_PLANNER_CHANNEL_ID`, `DISCORD_OWNER_ID`, optional `ANTHROPIC_API_KEY`).
4. `docker compose build` then `docker compose up -d` (or Deploy in Dockge). `docker compose ps` should show `api`, `bot`, `cloudflared` healthy.
5. Check: `curl https://api.travel.zachle.info/v1/health`; a tile URL from the site; `https://travel.zachle.info/api/live`; post a test message in #planner and watch the reactions and the thread reply; check `docker compose logs bot` says "logged in".
6. `tiles` bind-mounts `./tiles` as the live stack does. The named volumes are `api_data` and `bot_data`; back them up with `docker run --rm -v travel-backend_api_data:/d -v $PWD:/b alpine tar czf /b/api_data.tgz -C /d .`.

The first run of the bot records the newest message as its starting point; it does not file older history. To process older posts, leave them to the planner routine.

## Rollback to the interim caddy stub
```
docker compose down
cp compose.interim.yaml compose.yaml      # the caddy:2.11.9-alpine stub + tiles + cloudflared, saved in step 2
docker compose up -d
```
The `api_data` and `bot_data` volumes are not touched, so moving forward again keeps all data. The Worker keeps working against either stack (the stub ignores `X-Travel-Proxy`). The scheduled cloud planner routine stays the backup path the whole time.

## Tests
`backend/test.sh` runs everything from a clean worktree: it runs `npm ci` in `backend/bot` when `node_modules` is missing (that also installs the pinned `typescript` used for the type check). Node 22.18 or newer; Docker is optional, the compose-config tests skip without it:
- types (`tsc -p backend/tsconfig.json`)
- `api/test/api.test.ts`: health, live shape, private filtering, proxy secret on/off, admin auth, validation, rate limits (keyed on `cf-connecting-ip` only), tiles proxy headers and 502, WAL persistence
- `bot/test/planner.test.ts`: reaction state machine, the destination matrix (📅 🎟️ 📍 💭 🔒 combinations), private and undo, queue path with no key, retries, idempotence (gateway plus sweep, repeated sweeps, crash recovery), catch-up of missed posts and taps; `parser.test.ts`: request shape, refusal, sanitising, private text rules, config and model env; `discord.test.ts`: discord.js adapter against a fake client, including `allowedMentions`
- `compose.test.mjs`: `docker compose config` (valid, four services, healthchecks, no host ports, each of the six required secrets refused when missing)

**Not wired into `scripts/check.sh`**: that file is outside this task's claim (`backend/`, `docs/BACKEND.md`). NEED-PATHS: `scripts/check.sh` (add `step "backend" && backend/test.sh` to the full check, not `--fast`, since it needs `npm ci` for the bot).

## Owner must provide
- `ADMIN_TOKEN` (`openssl rand -base64 48`)
- `PROXY_SECRET` (same way), **also as a Worker secret**: `npx wrangler secret put PROXY_SECRET`
- `DISCORD_BOT_TOKEN` and `DISCORD_PLANNER_CHANNEL_ID` and `DISCORD_OWNER_ID` (required); the bot must be invited to the server with View Channel, Read Message History, Add Reactions, Send Messages in Threads, Create Public Threads, and the Message Content Intent turned on
- `ANTHROPIC_API_KEY` only if he wants instant AI parsing (costs per post; optional, and `ANTHROPIC_MODEL` to pick another model)
- `TUNNEL_TOKEN` (already live on the interim stack)
