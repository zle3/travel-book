#!/usr/bin/env bash
# Task claims: one owner per task, no two open tasks may touch the same paths.
#   task.sh claim <id> <agent> "<title>" <path>...   claim paths (prefix match) or fail on overlap; state: claimed
#   task.sh start <id> [--no-install]                create worktree + branch task/<id>; state: started. Then prepares node_modules
#                                                    (copy of a per-lockfile cache next to the worktrees, ~2 s; falls back to `npm ci`
#                                                    on a cache miss or any failure, then fills the cache; last 3 lockfiles kept) and prints the time.
#                                                    --no-install skips that. Install runs after the ops lock is released.
#   task.sh grant <id> <path>...                     add paths to an existing claim (same overlap check; records who/when via $KOTONE_AGENT)
#   task.sh handoff <id> <new-agent> "<reason>"      escalation: same task, worktree and branch move to a higher tier
#   task.sh release <id> [--force] [note]            close the claim. Refused while queued/merging, or while the worktree is dirty (--force overrides dirty).
#   task.sh list                                     open claims with state (flags MISSING WORKTREE)
#   task.sh verify [<id>]                            MISSING + a recreate hint (git worktree add -f -f <wt> task/<id>) for every started claim whose worktree dir is gone; rc 1 if any
# Worktree safety: `start` locks the worktree (git worktree lock); `release` unlocks it first. `release` is the ONLY code path that removes a task worktree, via remove_worktree in lib.sh (claim must exist, record exactly
#   that path, state must allow release). Every removal and refusal is logged to $OPS_DIR/worktree-removals.log (time, id, path, caller,
#   $KOTONE_AGENT, parent chain, result). `start` records `worktree-created:` in the claim and writes <worktree>/.kotone-task (git-ignored).
#   task.sh who <path>                               which task owns a path
# Hooks (optional, best-effort): a project may ship executable ops/hooks/start and ops/hooks/release (looked up in the main
#   checkout, falling back to the worktree copy). `start` runs `ops/hooks/start <id> <worktree>` once, right after the worktree/branch
#   is created (cwd = worktree). `release` runs `ops/hooks/release <id> <worktree>` just before the worktree is removed (also via
#   mq.sh auto-release; not run when the worktree is kept). Env: KOTONE_TASK_ID, KOTONE_WORKTREE, KOTONE_OPS_DIR. An absent hook is a
#   silent no-op; a failing hook prints a WARNING and never changes the exit code or blocks start/release.
# State machine (only set_state in lib.sh changes it): claimed > started > queued > merging > merged|failed > released.
# Re-claiming a released id works if branch task/<id> is already merged into main; otherwise it is refused.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
cmd="${1:-list}"; shift || true

# conflict <id-to-skip> <path>...: print + return 1 if a path overlaps another open claim
conflict() {
  local skip="$1"; shift; local f p want
  for f in "$OPS_DIR"/claims/*; do
    [[ "$(basename "$f")" == "$skip" ]] && continue
    while read -r p; do for want in "$@"; do
      if overlap "$want" "$p"; then echo "CONFLICT: $want overlaps $p, owned by task $(basename "$f") ($(f_get "$f" agent)). Wait, or ask the lead to sequence it."; return 1; fi
    done; done < <(sed -n 's/^path: //p' "$f")
  done
  return 0
}
base_ref() { local b="origin/main"; git rev-parse -q --verify "$b" >/dev/null || b="main"; echo "$b"; }
branch_ok() { # branch task/<id> absent, or fully merged into the base (then it can be reused)
  local id="$1"
  git rev-parse -q --verify "refs/heads/task/$id" >/dev/null || return 0
  git merge-base --is-ancestor "task/$id" "$(base_ref)"
}

# run_hook <name> <id> <worktree>: optional project hook ops/hooks/<name>; absent = silent no-op; failure = warning only.
run_hook() {
  local name="$1" id="$2" wt="$3" h="" c hrc=0
  for c in "$MAIN_WT/ops/hooks/$name" "$wt/ops/hooks/$name"; do [[ -f "$c" && -x "$c" ]] && { h="$c"; break; }; done
  [[ -n "$h" ]] || return 0
  ( cd "$wt" && KOTONE_TASK_ID="$id" KOTONE_WORKTREE="$wt" KOTONE_OPS_DIR="$OPS_DIR" "$h" "$id" "$wt" ) || hrc=$?
  [[ $hrc -eq 0 ]] || echo "WARNING: ops/hooks/$name failed for task $id (rc=$hrc); continuing (hooks are best-effort)"
  return 0
}

do_claim() {
  local id="$1" agent="$2" title="$3"; shift 3
  [[ -e "$(claim_file "$id")" ]] && { echo "task $id already claimed:"; cat "$(claim_file "$id")"; return 1; }
  branch_ok "$id" || { echo "REFUSED: branch task/$id exists and has commits not in $(base_ref). Pick a new task id, or have the lead finish/merge that branch first."; return 1; }
  conflict "" "$@" || return 1
  { echo "id: $id"; echo "agent: $agent"; echo "title: $title"; echo "branch: task/$id"; echo "claimed: $(date -Is)"; echo "state: claimed"
    for p in "$@"; do echo "path: $p"; done; } | atomic_write "$(claim_file "$id")"
  echo "claimed $id for $agent"
}
do_start() {
  local id="$1" f st wt base; f="$(claim_file "$id")"
  [[ -e "$f" ]] || { echo "claim $id first"; return 1; }
  st="$(get_state "$id")"
  wt="$WORKTREES/$SLUG-$id"; base="$(base_ref)"
  if [[ "$st" == started || ( "$st" == legacy && -d "$wt" ) ]]; then echo "worktree: $wt"; return 0; fi
  [[ "$st" == claimed || "$st" == legacy ]] || { echo "task $id is $st, cannot start"; return 1; }
  branch_ok "$id" || { echo "REFUSED: branch task/$id has unmerged commits"; return 1; }
  if [[ ! -d "$wt" ]]; then git worktree add -q -B "task/$id" "$wt" "$base"; fi
  wt_lock "$wt" "$id"   # `git worktree prune` / `remove` by others can no longer take it; release unlocks first
  f_set "$f" worktree "$wt" && f_set "$f" worktree-created "$wt $(date -Is)" && mark_worktree "$id" "$wt" && set_state "$id" started && echo "worktree: $wt"
}
# mark_worktree <id> <wt>: write <wt>/.kotone-task (the task id) and keep it out of git via info/exclude (no tracked change).
mark_worktree() {
  local id="$1" wt="$2" ex
  printf '%s\n' "$id" >"$wt/.kotone-task" || { echo "WARNING: cannot write $wt/.kotone-task"; return 0; }
  ex="$(git -C "$wt" rev-parse --path-format=absolute --git-path info/exclude 2>/dev/null || true)"
  if [[ -n "$ex" ]]; then mkdir -p "$(dirname "$ex")"; grep -qxF '/.kotone-task' "$ex" 2>/dev/null || echo '/.kotone-task' >>"$ex"; fi
  return 0
}
# missing_worktree <id>: prints a MISSING line and returns 0 when a started claim's worktree directory is gone.
missing_worktree() {
  local id="$1" f wt st; f="$(claim_file "$id")"; [[ -e "$f" ]] || return 1
  wt="$(f_get "$f" worktree)"; st="$(get_state "$id")"
  [[ -n "$wt" && ! -d "$wt" ]] || return 1
  case "$st" in started|queued|merging|failed|legacy) ;; *) return 1 ;; esac
  echo "MISSING: task $id ($st): worktree $wt is gone. Recreate it with: git worktree add -f -f $wt task/$id"
}
do_grant() {
  local id="$1" f p who; shift; f="$(claim_file "$id")"
  [[ -e "$f" ]] || { echo "no claim $id"; return 1; }
  conflict "$id" "$@" || return 1
  who="${KOTONE_AGENT:-${USER:-unknown}}"
  { cat "$f"; for p in "$@"; do echo "path: $p"; echo "grant: $(date -Is) by $who: $p"; done; } | atomic_write "$f"
  echo "granted $* to $id"
}
do_handoff() {
  local id="$1" agent="$2" reason="$3" f old; f="$(claim_file "$id")"
  [[ -e "$f" ]] || { echo "no claim $id"; return 1; }
  old="$(f_get "$f" agent)"
  f_set "$f" agent "$agent" && f_append "$f" "escalated: $(date -Is) $old -> $agent: $reason"
  echo "task $id handed from $old to $agent"
}
do_release() {
  local id="$1" force="$2" merged="$3" note="$4" f st wt dirty="" keep="" rc=0 d; f="$(claim_file "$id")"
  [[ -e "$f" ]] || { echo "no claim $id"; return 1; }
  st="$(get_state "$id")"
  case "$st" in queued|merging) echo "REFUSED: task $id is $st (in the merge queue). Wait for the merge queue, or dequeue with: mq.sh remove <pr>"; return 1 ;; esac
  [[ "$merged" == 1 && "$st" != merged ]] && { echo "REFUSED: --merged needs state merged, task $id is $st"; return 1; }
  wt="$(f_get "$f" worktree)"
  if [[ -n "$wt" && -d "$wt" ]]; then
    if inside "$wt" "$ORIG_PWD" || inside "$wt" "${KOTONE_RUNNER_ROOT:-}"; then keep="the caller/runner is running inside it"
    elif [[ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]]; then
      if [[ "$merged" == 1 ]]; then keep="uncommitted changes (kept for the lead)"
      elif [[ "$force" != 1 ]]; then echo "REFUSED: worktree $wt has uncommitted changes. Commit/discard them, or use --force."; return 1; fi
    fi
  fi
  valid_next "$st" released || { echo "task $id: illegal state transition $st -> released"; return 1; }
  # The worktree goes first, while the claim still exists: remove_worktree checks the claim and logs the removal.
  if [[ -n "$wt" ]]; then   # also when the folder is gone: remove_worktree then drops this worktree's own (locked) entry
    if [[ -n "$keep" ]]; then echo "WARNING: kept worktree $wt: $keep"; wt_log "$id" "$wt" "task.sh release" "kept: $keep"
    else
      [[ ! -d "$wt" ]] || run_hook release "$id" "$wt"
      if remove_worktree "$id" "$wt" "task.sh release"; then echo "removed worktree $wt"
      else echo "WARNING: claim released but could not remove worktree $wt"; rc=4; fi
    fi
  fi
  set_state "$id" released "$note" || return 1
  f_append "$f" "released: $(date -Is) $note"
  d="$OPS_DIR/done/$id"; [[ -e "$d" ]] && mv -f "$d" "$d.$(date +%s%N)"
  mv -f "$f" "$d"
  echo "released $id"; return $rc
}

case "$cmd" in
  claim)
    id="$1" agent="$2" title="$3"; shift 3
    [[ $# -gt 0 ]] || { echo "name at least one path"; exit 2; }
    locked do_claim "$id" "$agent" "$title" "$@" ;;
  start)
    git fetch -q origin main 2>/dev/null || true
    id="${1:?usage: task.sh start <id> [--no-install]}"; install=1
    for a in "${@:2}"; do case "$a" in --no-install) install=0 ;; *) echo "unknown option: $a"; exit 2 ;; esac; done
    pre="$(get_state "$id" 2>/dev/null || true)"
    locked do_start "$id"
    if [[ "$pre" == claimed ]]; then
      wt="$(f_get "$(claim_file "$id")" worktree)"
      [[ -n "$wt" && -d "$wt" ]] && run_hook start "$id" "$wt"
    fi
    if [[ $install == 1 ]]; then
      wt="$(f_get "$(claim_file "$id")" worktree)"
      [[ -n "$wt" && -d "$wt" ]] || { echo "no worktree recorded for $id"; exit 1; }
      prepare_node_modules "$wt" || { echo "ERROR: node_modules install failed in $wt (worktree and claim are fine; run npm ci there)"; exit 5; }
    fi ;;
  grant)
    id="$1"; shift; [[ $# -gt 0 ]] || { echo "name at least one path"; exit 2; }
    locked do_grant "$id" "$@" ;;
  handoff) locked do_handoff "$1" "$2" "$3" ;;
  release)
    id="$1"; shift; force=0 merged=0 note=""
    for a in "$@"; do case "$a" in --force) force=1 ;; --merged) merged=1 ;; *) note="$a" ;; esac; done
    locked do_release "$id" "$force" "$merged" "$note" ;;
  list)
    files=("$OPS_DIR"/claims/*)
    [[ ${#files[@]} -eq 0 ]] && { echo "no open tasks"; exit 0; }
    for f in "${files[@]}"; do printf '%s | %s | %s | %s | %s%s\n' "$(f_get "$f" id)" "$(get_state "$(basename "$f")")" "$(f_get "$f" agent)" "$(f_get "$f" title)" "$(sed -n 's/^path: //p' "$f" | paste -sd, -)" \
      "$(missing_worktree "$(basename "$f")" >/dev/null && echo ' | MISSING WORKTREE (task.sh verify)')"; done ;;
  verify)
    # verify [<id>]: MISSING (rc 1) for every started claim whose worktree directory is gone; with no id checks all open claims.
    bad=0; ids=("$@"); [[ ${#ids[@]} -gt 0 ]] || for f in "$OPS_DIR"/claims/*; do ids+=("$(basename "$f")"); done
    for id in "${ids[@]}"; do
      [[ -e "$(claim_file "$id")" ]] || { echo "no claim $id"; bad=1; continue; }
      if missing_worktree "$id"; then bad=1; else echo "OK: task $id"; fi
    done
    exit $bad ;;
  who)
    for f in "$OPS_DIR"/claims/*; do
      while read -r p; do overlap "$1" "$p" && echo "$(basename "$f"): $(f_get "$f" agent) ($p)"; done < <(sed -n 's/^path: //p' "$f")
    done ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
