#!/usr/bin/env bash
# Local CI. Nothing runs on GitHub Actions: this script is the gate.
#   scripts/check.sh          full gate (merge queue runs this, one at a time)
#   scripts/check.sh --fast   authors: types + unit tests + build + design lint
set -euo pipefail
cd "$(dirname "$0")/.."
FAST=0; [[ "${1:-}" == "--fast" ]] && FAST=1
step() { printf '\n== %s\n' "$*"; }

step "install (npm ci if lockfile changed)"
if [[ ! -d node_modules || package-lock.json -nt node_modules/.package-lock.json ]]; then npm ci --no-audit --no-fund; fi

step "type check (astro check)"
npx astro check --minimumSeverity error

step "design lint"
node scripts/test/lint-design.mjs

step "unit tests (scripts/test/unit/*.test.mjs, scripts/test/gate.test.mjs)"
# Only pass files that exist: `node --test` with no file args would scan the whole tree.
shopt -s nullglob
units=(scripts/test/unit/*.test.mjs)
[[ -f scripts/test/gate.test.mjs ]] && units+=(scripts/test/gate.test.mjs)
if (( ${#units[@]} )); then node --test "${units[@]}"; else echo "no unit test files yet, OK"; fi

step "ops lifecycle tests (scripts/test/ops-lifecycle.test.mjs)"
# Git hooks export GIT_DIR / GIT_INDEX_FILE. The test's throwaway repos would inherit them and commit into the real repo,
# so run it with every GIT_* variable removed.
env $(env | sed -n 's/^\(GIT_[A-Z_]*\)=.*/-u \1/p') node --test scripts/test/ops-lifecycle.test.mjs

step "build"
npx astro build

if [[ $FAST == 1 ]]; then
  # Stamp for `mq.sh add` (KOTONE_MQ_REQUIRE_FAST_STAMP=1): this exact commit passed --fast with a clean tree.
  if [[ -z "$(git status --porcelain 2>/dev/null)" ]]; then
    [[ ! -f ops/project.conf ]] || . ops/project.conf
    stamp_dir="${KOTONE_OPS_DIR:-$(git rev-parse --path-format=absolute --git-common-dir)/${KOTONE_OPS_DIRNAME:-kotone-ops}}"
    mkdir -p "$stamp_dir" && : >"$stamp_dir/fast-ok-$(git rev-parse HEAD)" && echo "stamp: $stamp_dir/fast-ok-$(git rev-parse HEAD)"
  else echo "tree not clean: no fast-ok stamp written (commit, then re-run --fast)"; fi
  echo; echo "check --fast: OK"; exit 0
fi

step "internal links"
node scripts/test/linkcheck.mjs dist

step "browser smoke (every route, desktop + phone, light + dark)"
node scripts/test/smoke.mjs

step "races (scripts/test/races/*.race.mjs)"
node scripts/test/races.mjs

echo; echo "check: OK"
