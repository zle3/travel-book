#!/usr/bin/env bash
# Backend checks: types, API tests, bot tests, compose config. Run from anywhere: backend/test.sh
# Installs the bot's dependencies itself (npm ci in bot/, which also provides typescript) when bot/node_modules is missing.
# Needs Node >= 22.18 (type stripping, node:sqlite). Docker is optional (the compose check is skipped without it).
set -euo pipefail
cd "$(dirname "$0")"
export NODE_NO_WARNINGS=1
[[ -d bot/node_modules ]] || (cd bot && npm ci --no-audit --no-fund)
echo "== types"; bot/node_modules/.bin/tsc -p tsconfig.json
echo "== api tests"; (cd api && node --test test/*.test.ts)
echo "== bot tests"; (cd bot && node --test test/*.test.ts)
echo "== compose"; node --test compose.test.mjs
echo "backend: OK"
