#!/usr/bin/env bash
# Local test of mq.sh wait/merge logic with a fake gh (KOTONE_MQ_GH). Needs the branch pushed to origin.
#   scripts/ops/mq-test.sh <branch>     runs scenarios: unknown2 | conflict | never | mergeretry | hardfail | transient
# Never pushes or merges anything; uses an isolated ops dir and worktree dir.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
branch="${1:?branch on origin}"; T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
cat > "$T/gh" <<'STUB'
#!/usr/bin/env bash
# fake gh. KOTONE_STUB_MODE picks the scenario; counters live in $KOTONE_STUB_DIR.
d="$KOTONE_STUB_DIR"; bump() { local n=$(( $(cat "$d/$1" 2>/dev/null || echo 0) + 1 )); echo $n > "$d/$1"; echo $n; }
oid="$(git rev-parse HEAD)"
if [[ "$1 $2" == "pr view" ]]; then
  n=$(bump view)
  case "$KOTONE_STUB_MODE" in
    unknown2) if [[ $n -le 2 ]]; then printf 'deadbeef\tUNKNOWN\tUNKNOWN\n'; elif [[ $n -le 3 ]]; then printf '%s\tUNKNOWN\tUNKNOWN\n' "$oid"; else printf '%s\tMERGEABLE\tCLEAN\n' "$oid"; fi ;;
    conflict) printf '%s\tCONFLICTING\tDIRTY\n' "$oid" ;;
    never) printf '%s\tUNKNOWN\tUNKNOWN\n' "$oid" ;;
    *) printf '%s\tMERGEABLE\tCLEAN\n' "$oid" ;;
  esac
elif [[ "$1 $2" == "pr merge" ]]; then
  n=$(bump merge)
  case "$KOTONE_STUB_MODE" in
    mergeretry) [[ $n -le 1 ]] && { echo "GraphQL: Pull Request is not mergeable (mergePullRequest)"; exit 1; } ;;
    transient) echo "GraphQL: Pull Request is not mergeable (mergePullRequest)"; exit 1 ;;
    hardfail) echo "GraphQL: Resource not accessible"; exit 1 ;;
  esac
  echo "STUB merged $*"
fi
STUB
chmod +x "$T/gh"; rc_all=0
for mode in "${@:2}" ; do :; done
for mode in ${MODES:-unknown2 conflict never mergeretry hardfail transient}; do
  rm -rf "$T/ops" "$T/stub" "$T/wt"; git worktree prune; mkdir -p "$T/stub" "$T/wt"
  echo "=== scenario: $mode"
  mkdir -p "$T/ops/claims"; printf 'id: t-test\nagent: tester\ntitle: t\nbranch: task/t-test\nstate: started\npath: x\n' > "$T/ops/claims/t-test"
  KOTONE_OPS_DIR="$T/ops" KOTONE_WORKTREES="$T/wt" ./scripts/ops/mq.sh add 99 t-test tester no >/dev/null
  KOTONE_OPS_DIR="$T/ops" KOTONE_WORKTREES="$T/wt" KOTONE_MQ_HEAD="$branch" KOTONE_MQ_DRYRUN=gh KOTONE_MQ_GH="$T/gh" \
    KOTONE_STUB_DIR="$T/stub" KOTONE_STUB_MODE="$mode" KOTONE_MQ_POLL=1 KOTONE_MQ_WAIT=${WAITS:-6} KOTONE_MQ_BACKOFF=1 \
    ./scripts/ops/mq.sh run 2>&1 | tee "$T/out.$mode" | grep -E "^(PR |wait:|CONFLICT|TIMEOUT|transient|MERGE|STUB|queue|only)"
  echo "queue after: $(ls "$T/ops/queue" | wc -l) | done after: $(ls "$T/ops/done" | wc -l) | $(sed -n 's/^result: //p' "$T"/ops/done/* 2>/dev/null)"
done
git worktree prune
