# Site password gate: how to run it

This is the owner's how-to for the password gate on https://travel.zachle.info. The gate lives in the edge Worker (`worker/index.ts`). Technical detail is in `worker/README.md`; hosting and token details are in `ops/OPERATIONS.md`.

Run every command below in your own terminal. Never paste the password, or any secret, into a chat.

## What the gate does

The password gate is **permanent**: every visitor sees the password page ((with the credit set in `worker/site-config.ts`)) until they enter the password. A correct password sets a signed cookie that lasts 30 days. Search indexing is **off** by owner decision: search engines, including Google, Bing and Apple, get the gate too (`GATE_ALLOW_SEARCH="0"`), every response carries a `noindex` header, and robots.txt disallows all crawlers. AI crawlers and generic scrapers get a 403 whether or not they have a password. If the password is not configured, the gate fails closed and shows a "not configured" page.

## 1. Set the password the first time

1. Open a terminal and go to the repo:
   ```
   cd ~/projects/travel-book
   git pull
   ```
2. Load the Cloudflare token into this terminal session only:
   ```
   set -a; . ~/.config/travel-book/cloudflare.env; set +a
   ```
3. Store the site password:
   ```
   npx wrangler secret put SITE_PASSWORD
   ```
   Wrangler prompts `Enter a secret value:`. Type the password and press Enter. Nothing appears while you type, not even stars; this is normal. If Wrangler asks whether to create the Worker, answer `y`.
4. Store the cookie-signing key. This generates a random key, so you never type it:
   ```
   openssl rand -hex 32 | npx wrangler secret put GATE_SECRET
   ```
5. Check that both secrets exist. This prints names only, never values:
   ```
   npx wrangler secret list
   ```
   You should see `SITE_PASSWORD` and `GATE_SECRET`.

## 2. Change the password

1. Run step 2 of the section above to load the token.
2. Run `npx wrangler secret put SITE_PASSWORD` and enter the new password.
3. Everyone is signed out, because the cookie check uses a key derived from the secrets. Visitors, including you, sign in with the new password.

## 3. Sign everyone out without changing the password

1. Load the token (step 2 above).
2. Replace the cookie-signing key:
   ```
   openssl rand -hex 32 | npx wrangler secret put GATE_SECRET
   ```
3. All existing sign-ins stop working. The password stays the same.

## 4. The gate stays on

The gate is not turned off for this site. The `GATE_DISABLED` variable exists in the code for other uses, but **do not set it for travel.zachle.info**: it would open the whole site to everyone.

## Troubleshooting

| What you see | What it means | What to do |
| --- | --- | --- |
| "Not configured" page | `SITE_PASSWORD` is not set. The gate fails closed on purpose. | Run section 1, step 3. |
| "Too many attempts" (HTTP 429) | More than 10 failed passwords from your IP in 10 minutes. | Wait 10 minutes, then try again. |
| You are locked out of your own site | You forgot the password or set it wrongly. | Change the password (section 2), then sign in with the new one. |

## Where the token lives and what it needs

- The Cloudflare API token is in `~/.config/travel-book/cloudflare.env`. The file must be readable only by you: `chmod 600 ~/.config/travel-book/cloudflare.env`.
- It holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Agents read it at use and never print or commit it.
- Permissions the token needs (you add these in the Cloudflare dashboard; agents cannot change the token):
  - Account: **Workers Scripts → Edit**
  - Zone of `travel.zachle.info`: **Workers Routes → Edit**
  - Zone of `travel.zachle.info`: **DNS → Edit**
  - Zone of `travel.zachle.info`: **Zone → Read**

Until these permissions are present, upload and route commands fail with an authorization error.
