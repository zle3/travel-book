#!/usr/bin/env bash
# Deploy dist/ as a Cloudflare Worker with static assets (wrangler.jsonc). Direct upload, no Git integration,
# no GitHub Actions.
#   scripts/deploy.sh preview      -> uploads a version with a preview alias for the current branch (production untouched)
#   scripts/deploy.sh production   -> `wrangler deploy` of this project's Worker (merge queue only, from main, after check.sh rc=0)
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment, or ~/.config/<slug>/cloudflare.env.
# Project settings come from ops/project.conf (KOTONE_SLUG, and the optional placeholder guard below).
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:?usage: deploy.sh preview|production}"
[[ -f ops/project.conf ]] && . ops/project.conf
SLUG="${KOTONE_SLUG:-$(basename "$PWD")}"
ENV_FILE="$HOME/.config/$SLUG/cloudflare.env"
[[ -f "$ENV_FILE" ]] && set -a && . "$ENV_FILE" && set +a
# KOTONE_LEGACY_PREFIX (ops/project.conf): PTAI_<X> from the env or the env file also counts as KOTONE_<X>.
if [[ -n "${KOTONE_LEGACY_PREFIX:-}" ]]; then
  for _n in $(compgen -e); do
    [[ "$_n" == "${KOTONE_LEGACY_PREFIX}_"* ]] || continue
    _k="KOTONE_${_n#"${KOTONE_LEGACY_PREFIX}"_}"; [[ -n "${!_k+x}" ]] || export "$_k=${!_n}"
  done; unset _n _k
fi
: "${CLOUDFLARE_API_TOKEN:?missing CLOUDFLARE_API_TOKEN (see ops/OPERATIONS.md)}"
: "${CLOUDFLARE_ACCOUNT_ID:?missing CLOUDFLARE_ACCOUNT_ID}"
export CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID
export WRANGLER_SEND_METRICS=false
[[ -d dist ]] || { echo "no dist/: run scripts/check.sh first"; exit 1; }
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
SHA="$(git rev-parse --short HEAD)"

if [[ "$MODE" == production ]]; then
  # Only the exact origin/main commit ships (main branch, or detached at origin/main in the merge-queue worktree).
  [[ -z "$(git status --porcelain)" ]] || { echo "working tree not clean"; exit 1; }
  git fetch -q origin main
  [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || { echo "HEAD is not origin/main: production deploys only ship main"; exit 1; }
  # Owner-only content must be filled in before launch. Guard is configurable in ops/project.conf:
  #   KOTONE_PLACEHOLDER_PATHS   space-separated files/dirs to scan (missing paths are ignored; empty = guard off)
  #   KOTONE_PLACEHOLDER_PATTERN grep -E pattern that marks a placeholder (default: placeholder: true)
  PAT="${KOTONE_PLACEHOLDER_PATTERN:-placeholder: true}"
  if [[ "${KOTONE_ALLOW_PLACEHOLDERS:-0}" != 1 && -n "${KOTONE_PLACEHOLDER_PATHS:-}" ]]; then
    for p in $KOTONE_PLACEHOLDER_PATHS; do
      if [[ -e "$p" ]] && grep -rqE -- "$PAT" "$p"; then
        echo "placeholders remain in $p; set KOTONE_ALLOW_PLACEHOLDERS=1 to deploy anyway (owner approval only)"; exit 1
      fi
    done
  fi
  npx wrangler deploy --tag "$SHA" --message "main@$SHA"

elif [[ "$MODE" == preview ]]; then
  # Preview alias from the branch name: lowercase, anything outside [a-z0-9-] becomes '-', max 63 chars.
  ALIAS="$(printf '%s' "$BRANCH" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//' | cut -c1-63)"
  [[ -n "$ALIAS" ]] || { echo "cannot derive a preview alias from branch '$BRANCH'"; exit 1; }
  # versions upload does not change production traffic; the alias gives this version its own preview URL.
  OUT="$(npx wrangler versions upload --preview-alias "$ALIAS" --tag "$SHA" --message "$BRANCH@$SHA" 2>&1 | tee /dev/stderr)"
  URL="$(printf '%s\n' "$OUT" | grep -oE 'https://[^[:space:]]+' | grep -E 'workers\.dev' | head -n1 || true)"
  if [[ -n "$URL" ]]; then echo "preview URL: $URL"; else echo "preview uploaded (alias $ALIAS); no URL found in wrangler output above"; fi

else
  echo "unknown mode: $MODE (use preview|production)"; exit 2
fi
