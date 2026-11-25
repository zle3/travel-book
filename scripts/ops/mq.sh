#!/usr/bin/env bash
# Merge queue. FIFO of ready PRs; only the kotone-merge-queue agent runs `run`.
#   mq.sh add <pr> <task-id> <agent> [yes|no|deploy:yes|deploy:no]   author: enqueue a ready PR (claim must exist and be `started`);
#                                                      for a PR ALREADY queued it only refreshes the recorded reviewed commit when the current head has a valid
#                                                      review (same checks as a first add); position, hold, task, agent, deploy stay; a differing task, agent or
#                                                      deploy flag, or a merging entry, is refused; no valid review for the head: nothing changes, rc 1
#                                                      deploy flag is normalized to yes|no (default yes), anything else is refused
#                                                      --priority (or env KOTONE_MQ_PRIORITY=1): ahead of non-priority entries for the NEXT slot
#   mq.sh list                                         show the queue in order, held entries separately
#   mq.sh log [--since <date>]                         print the run log (one TSV line per processed entry) and a summary line
#   mq.sh hold <pr> | unhold <pr>                      lead: park an entry / put it back at its original position
#   mq.sh move <pr> <position>                         lead: move an entry to position N (numbers as shown by `list`)
#   mq.sh remove <pr>                                  lead: dequeue (claim goes back to `started`)
#   mq.sh run                                          merge queue agent: process the queue (one at a time, or in batches, see below)
# Order is an explicit `order:` number in each entry (never the filename). Claim state: queued -> merging (before work, so a
# crash leaves a visible entry) -> merged|failed. A `merging` entry found by the next run is finalized if its PR is already
# MERGED, otherwise retried. On merged the claim is released via the absolute path of task.sh (never `|| true`); a release
# failure is logged, reported and makes `run` exit 1. The runner's own worktree is never removed.
#   Test hooks (never set in real runs): KOTONE_MQ_DRYRUN=1 prints instead of push/merge/deploy;
#   KOTONE_MQ_DRYRUN=gh skips only the git push (then wait + merge run against KOTONE_MQ_GH=<fake gh script>);
#   KOTONE_MQ_GH=<path> replaces the gh binary; KOTONE_MQ_POLL/KOTONE_MQ_WAIT/KOTONE_MQ_BACKOFF = poll secs (3) / max wait secs (90) / merge retry backoff secs (5);
#   KOTONE_MQ_HEAD=<branch> skips the gh lookup and uses origin/<branch>; KOTONE_OPS_DIR=<dir> isolates queue state.
# Run log (KOTONE_MQ_LOG, default <ops dir>/mq-log): `run` appends ONE tab-separated line per processed entry, no header:
#   finished, pr, task, agent, added, started, wait_s, check_s, result, cause, batch_id, batch_size, merged_sha, deploy, deploy_s, review_note
#   result = merged | check-failed | review-stale | conflict | refused | deploy-failed | transient (retry left queued; not counted as a failure).
#   merged_sha = the checked head that was merged (--match-head-commit). In batch mode (N>1) deploy_s is the run's single deploy.
# Priority: an entry added with --priority goes after the leading run of priority/merging entries (FIFO among priority entries), ahead of
#   every non-priority entry. A running check is never preempted (the runner already holds that entry). `list` marks it PRIORITY.
# Fast stamp: KOTONE_MQ_REQUIRE_FAST_STAMP=1 makes `add` refuse unless <ops dir>/fast-ok-<PR head sha> exists (written by `check.sh --fast`).
# Fix-up rule (off unless KOTONE_MQ_FIXUP_TEST_GLOBS or KOTONE_MQ_FIXUP_DOC_GLOBS is set): a follow-up commit after `reviewed <sha>` keeps the
#   review only when <sha> is an ancestor of the head and `git diff <sha> <head>` is only modified (status M, mode unchanged, text) files that
#   were already in the PR's reviewed diff, each matching a test glob or a doc glob (bash patterns, `*` also matches `/`), within
#   KOTONE_MQ_FIXUP_MAX_LINES (default 40) added+deleted lines. Anything else needs a fresh review. Applied at add and again at run.
# Single flow guard: origin/main is fetched and must still equal the main that was merged in and checked, and merging the head into it must
# give the checked tree, immediately before EVERY `gh pr merge` attempt (also the retries). A moved main restarts the entry from the top
# (re-merge main, re-check; up to 3 attempts). After check.sh (both flows) HEAD must be unchanged and the tree clean (rc 27 / 32).
# Per entry: fixed worktree -> checkout PR head -> merge origin/main in -> scripts/check.sh (full)
#            -> push -> gh pr merge --match-head-commit -> optional production deploy -> release task.
# After the push we poll `gh pr view` until GitHub reports our pushed commit as headRefOid and mergeable != UNKNOWN
# (CONFLICTING -> rc 5, never reported -> rc 6), then merge, retrying up to 3x on "not mergeable"/"Base branch was modified".
# A PR whose changes are already in main (state MERGED, head an ancestor of origin/main, or every commit patch-equivalent per
# `git cherry`) is not checked or merged: the task is marked merged with "already contained in main", released, and the PR is
# closed with a comment if GitHub still shows it open. (Stacked PRs are forbidden by ops/OPERATIONS.md; this is the safety net.)
# Any failing step aborts that entry before push/merge/deploy; the claim is kept and the PR stays open.
# Outcomes: check/conflict/other failures move the entry to done and report. A TRANSIENT merge failure (rc 75: the check
# passed and was pushed, GitHub just would not merge yet) leaves the entry in the queue, so re-running `run` retries it
# without re-queueing; this run moves on to the next entry. After 3 transient runs it fails to done.
# Gates on `add` (fail closed; a refused add leaves the claim `started` and nothing queued):
#   1. Review gate: the PR must carry a comment whose body is EXACTLY `reviewed <sha>`, <sha> = the PR's CURRENT 40-char head
#      commit (a kotone-reviewer pass; any later push makes it stale). If gh cannot be read, the add is refused.
#      KOTONE_MQ_REQUIRE_REVIEW (project.conf or env, default 1; only the value 0 turns the gate off).
#      The lead may waive ONE PR with env KOTONE_MQ_REVIEW_WAIVE=<pr> (printed as a WARNING). `add` records the reviewed sha
#      (or WAIVED / OFF) in the entry as `reviewed:`; `run` re-verifies it per entry/batch member (rc 29): the PR's head must be that
#      sha or a commit the runner itself pushed (`pushed:` lines, so transient retries work). New commits after `add` = refused, claim
#      `failed`, re-add after a fresh review. An entry recorded OFF/without `reviewed:` is refused while the gate is on.
#      Loud stderr WARNINGs on add/run: REQUIRE_REVIEW=0, REVIEW_WAIVE set, KOTONE_MQ_GH set without an isolated KOTONE_OPS_DIR, and
#      any hook file that exists but is not executable (it is ignored).
#   2. Hook ops/hooks/mq-add (optional, executable; main checkout first, then the task worktree): `mq-add <pr> <task-id>`,
#      env KOTONE_PR, KOTONE_TASK_ID, KOTONE_WORKTREE, KOTONE_OPS_DIR, cwd = task worktree. NON-ZERO EXIT REFUSES the add (its output
#      is shown). Absent = no-op. It runs under the queue lock: it must not call mq.sh.
# Hook ops/hooks/mq-pre-merge (optional, executable, same lookup): run in the queue worktree after origin/main (single) or all PR heads
#   (batch) were merged in, BEFORE the full check, as `mq-pre-merge <pr...>` with env KOTONE_PR_LIST="<pr...>", KOTONE_BATCH=0|1,
#   KOTONE_OPS_DIR. It may modify and COMMIT files (version numbers, changelog fragments); it must leave the tree clean (no uncommitted
#   or untracked files) and only add commits on top, otherwise the entry/batch is aborted. Non-zero = entry fails (claim kept,
#   PR open; in a batch: the batch falls back to singles). Its commits are checked and pushed together with the PR head.
# Deploy: KOTONE_MQ_DEPLOY_CHECK (fast default | full | none, project.conf or env) picks the check before a production deploy; none skips it only
#   while origin/main's tree equals the tree the queue fully checked. KOTONE_MQ_DEPLOY_ARG (default production) is deploy.sh's first argument.
# Batching: KOTONE_MQ_BATCH=N (project.conf or env; default 1 = exactly the per-entry flow below). With N>1 `run` takes up to N
#   consecutive runnable (not held) entries with the SAME deploy flag and builds ONE candidate in the queue worktree: origin/main, then each
#   PR head merged in order (commits C1..Cn), then the pre-merge hook once (batch=1), then ONE full check. The checked tip (Cn, plus any
#   hook commits) is pushed as the head of the LAST PR; C1..Cn-1 are pushed as the heads of PRs 1..n-1 (each head contains the previous
#   ones). Then each PR is merged on GitHub in order with --match-head-commit. TREE-EQUALITY GUARD (fail closed), before the first push and
#   before EACH GitHub merge, after a fresh fetch: origin/main must be exactly the assembly base (first PR) or have the same tree as the
#   previous pushed head, AND `git merge-tree --write-tree origin/main <head>` must equal that head's tree (for the last PR: the tree that was
#   checked). Anything else (main moved, conflict, differing tree) stops the batch. A failed batch (assembly conflict, hook, check, push,
#   guard, merge) falls back to singles in order: PRs already merged stay merged, the rest are processed one by one through the normal flow,
#   so one bad PR fails alone. After a push, PR heads contain their predecessors, so a failed batch RESTORES every pushed, unmerged PR head
#   to its pre-batch sha (git push --force-with-lease=<branch>:<our pushed sha>, the only force push the scripts make). If a head cannot be
#   restored the unmerged entries are FAILED (no singles), with an ERROR on stdout and stderr. With N>1 production deploys happen ONCE per run, after the last merge, if any
#   merged entry asked for deploy yes (with N=1 deploy stays per entry).
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
TASKSH="$HERE/task.sh"
cmd="${1:-list}"; shift || true
GH="${KOTONE_MQ_GH:-gh}"
POLL="${KOTONE_MQ_POLL:-3}"; WAIT="${KOTONE_MQ_WAIT:-90}"; BACKOFF="${KOTONE_MQ_BACKOFF:-5}"
BATCH="${KOTONE_MQ_BATCH:-1}"
[[ "$BATCH" =~ ^[1-9][0-9]*$ ]] || { echo "WARNING: KOTONE_MQ_BATCH='$BATCH' is not a positive integer; using 1"; BATCH=1; }
DEPLOY_CHECK="${KOTONE_MQ_DEPLOY_CHECK:-fast}"; DEPLOY_ARG="${KOTONE_MQ_DEPLOY_ARG:-production}"
REQUIRE_REVIEW="${KOTONE_MQ_REQUIRE_REVIEW:-1}"   # only the exact value 0 disables the review gate
MQLOG="${KOTONE_MQ_LOG:-$OPS_DIR/mq-log}"
REQUIRE_FAST_STAMP="${KOTONE_MQ_REQUIRE_FAST_STAMP:-0}"   # only the exact value 1 turns the stamp requirement on
FIXUP_TEST_GLOBS="${KOTONE_MQ_FIXUP_TEST_GLOBS:-}"; FIXUP_DOC_GLOBS="${KOTONE_MQ_FIXUP_DOC_GLOBS:-}"; FIXUP_MAX_LINES="${KOTONE_MQ_FIXUP_MAX_LINES:-40}"
[[ "$FIXUP_MAX_LINES" =~ ^[0-9]+$ ]] || { echo "WARNING: KOTONE_MQ_FIXUP_MAX_LINES='$FIXUP_MAX_LINES' is not a number; using 40" >&2; FIXUP_MAX_LINES=40; }
FIXUP_REPO="$ROOT"; FIXUP_NOTE=""   # run sets FIXUP_REPO to the queue worktree and FIXUP_NOTE to a per-entry note file
warn() { echo "WARNING: $*" >&2; }
# Safety switches announce themselves once per add/run, on stderr. "Test mode" = an isolated KOTONE_OPS_DIR.
if [[ "$cmd" == add || "$cmd" == run ]]; then
  [[ "$REQUIRE_REVIEW" != 0 ]] || warn "KOTONE_MQ_REQUIRE_REVIEW=0: the review gate is OFF (PRs are not required to carry a 'reviewed <sha>' comment)"
  [[ -z "${KOTONE_MQ_REVIEW_WAIVE:-}" ]] || warn "KOTONE_MQ_REVIEW_WAIVE=${KOTONE_MQ_REVIEW_WAIVE} is set: the review gate is waived for PR ${KOTONE_MQ_REVIEW_WAIVE}"
  [[ -z "${KOTONE_MQ_GH:-}" || -n "${KOTONE_OPS_DIR:-}" ]] || warn "KOTONE_MQ_GH=${KOTONE_MQ_GH} replaces the gh binary against the REAL queue (no isolated KOTONE_OPS_DIR); unset it outside tests"
fi

# wait_mergeable <pr> <oid>: 0 ready; 5 conflicting; 6 timeout. Explicit returns, no reliance on set -e.
wait_mergeable() {
  local pr="$1" oid="$2" deadline out o m st
  deadline=$(( $(date +%s) + WAIT ))
  while :; do
    out="$("$GH" pr view "$pr" --json mergeable,mergeStateStatus,headRefOid -q '[.headRefOid,.mergeable,.mergeStateStatus]|@tsv' 2>&1)"
    IFS=$'\t' read -r o m st <<<"$out"
    echo "wait: head=${o:-?} mergeable=${m:-?} state=${st:-?}"
    if [[ "$o" == "$oid" ]]; then
      [[ "$m" == CONFLICTING ]] && { echo "CONFLICTING: GitHub reports PR $pr cannot merge"; return 5; }
      [[ "$m" == MERGEABLE ]] && return 0
    fi
    [[ $(date +%s) -ge $deadline ]] && { echo "TIMEOUT: GitHub never reported mergeability for $oid on PR $pr within ${WAIT}s"; return 6; }
    sleep "$POLL"
  done
}

# merge_pr <pr> <oid> [guard cmd...]: 0 merged; 75 transient failure after 3 tries; other rc = immediate hard failure. The guard
# command (if any) runs immediately before EVERY `gh pr merge` attempt, including retries; a non-zero guard rc is returned as is and
# nothing is merged.
merge_pr() {
  local pr="$1" oid="$2" n=1 out rc grc; shift 2
  while :; do
    if [[ $# -gt 0 ]]; then "$@" || { grc=$?; echo "GUARD refused the merge of PR $pr (rc=$grc): nothing merged"; return "$grc"; }; fi
    out="$("$GH" pr merge "$pr" --merge --match-head-commit "$oid" 2>&1)"; rc=$?
    echo "$out"
    [[ $rc -eq 0 ]] && return 0
    if ! grep -Eqi 'not mergeable|base branch was modified' <<<"$out"; then echo "MERGE FAILED (rc=$rc, not transient)"; return "$rc"; fi
    [[ $n -ge 3 ]] && { echo "MERGE FAILED: still transient after $n tries (rc 75, entry stays queued)"; return 75; }
    echo "transient merge failure (try $n/3), retrying in $(( BACKOFF * n ))s"; sleep $(( BACKOFF * n )); n=$((n+1))
  done
}

# ---- queue helpers (callers hold the lock when they write) -----------------------------------
qfile() { local f; for f in "$OPS_DIR"/queue/*; do [[ "$(f_get "$f" pr)" == "$1" ]] && { echo "$f"; return 0; }; done; return 1; }
q_sorted() { # all entry files in explicit order (legacy entries without `order:` sort first, by name)
  local f o; for f in "$OPS_DIR"/queue/*; do o="$(f_get "$f" order)"; printf '%s\t%s\n' "${o:-0}" "$f"; done | sort -s -n -k1,1 | cut -f2
}
q_renumber() { # stdin: files in the wanted order -> order: 1..n
  local i=0 f; while read -r f; do i=$((i+1)); [[ "$(f_get "$f" order)" == "$i" ]] || f_set "$f" order "$i"; done
}
# find_hook <name> <dir>: path of ops/hooks/<name> (main checkout first, then <dir>); rc 1 when absent or not executable.
find_hook() {
  local c; for c in "$MAIN_WT/ops/hooks/$1" "$2/ops/hooks/$1"; do
    [[ -f "$c" && -x "$c" ]] && { echo "$c"; return 0; }
    [[ -f "$c" ]] && warn "hook $c exists but is not executable: IGNORED (chmod +x it)"
  done; return 1
}
# review_gate <pr>: rc 0 only when a comment is exactly `reviewed <current head sha>`; every error path refuses.
# It sets REVIEWED_SHA (the reviewed head, WAIVED or OFF), which `add` records in the entry for `run` to re-verify.
REVIEWED_SHA=""; REVIEW_BASE=""; REVIEW_FIXUP=""; REVIEW_HEAD=""
review_gate() {
  local pr="$1" head bodies
  REVIEW_BASE=""; REVIEW_FIXUP=""; REVIEW_HEAD=""
  [[ "$REQUIRE_REVIEW" == 0 ]] && { REVIEWED_SHA=OFF; return 0; }
  if [[ "${KOTONE_MQ_REVIEW_WAIVE:-}" == "$pr" ]]; then echo "WARNING: review gate waived for PR $pr (KOTONE_MQ_REVIEW_WAIVE)"; REVIEWED_SHA=WAIVED; return 0; fi
  head="$("$GH" pr view "$pr" --json headRefOid -q .headRefOid 2>&1)" || { echo "REFUSED: cannot read the head of PR $pr from GitHub: $head"; return 1; }
  [[ "$head" =~ ^[0-9a-f]{40}$ ]] || { echo "REFUSED: GitHub did not return a 40-char head commit for PR $pr (got: ${head:0:80})"; return 1; }
  REVIEW_HEAD="$head"
  bodies="$("$GH" pr view "$pr" --json comments -q '.comments[].body|@json' 2>&1)" || { echo "REFUSED: cannot read the comments of PR $pr from GitHub: ${bodies:0:200}"; return 1; }
  if ! grep -Fxq -- "\"reviewed $head\"" <<<"$bodies"; then
    local why="" cand
    if fixup_enabled; then
      git -C "$FIXUP_REPO" fetch -q origin 2>/dev/null || true
      while read -r cand; do
        [[ -n "$cand" ]] || continue
        if REVIEW_FIXUP="$(fixup_ok "$cand" "$head")"; then REVIEW_BASE="$cand"; break; fi
        why="$REVIEW_FIXUP"; REVIEW_FIXUP=""
      done < <(grep -oE '^"reviewed [0-9a-f]{40}"$' <<<"$bodies" | tr -d '"' | awk '{print $2}' | tac)
    fi
    [[ -n "$REVIEW_BASE" ]] || {
      echo "REFUSED: PR $pr has no review for its current head. Get a kotone-reviewer pass: a comment whose body is exactly 'reviewed $head' (a push after the review makes it stale)."
      [[ -z "$why" ]] || echo "(fix-up rule did not apply: $why)"; return 1; }
    echo "review of PR $pr kept by fix-up rule: $REVIEW_FIXUP (reviewed $REVIEW_BASE, head $head)"
  fi
  REVIEWED_SHA="$head"
}
# fixup_enabled: the fix-up rule is on only when a project lists test or doc globs.
fixup_enabled() { [[ -n "$FIXUP_TEST_GLOBS$FIXUP_DOC_GLOBS" ]]; }
# fixup_ok <reviewed sha> <head sha>: rc 0 and the changed files (comma separated) on stdout when the follow-up diff is mechanically safe;
# rc 1 and the reason on stdout otherwise. Runs git in $FIXUP_REPO (the queue worktree at run, the checkout at add).
fixup_ok() {
  local rv="$1" hd="$2" numstat g mb files="" f n=0 add del lines=0 reviewed_files om nm ost path globs ok pat
  local -a tg dg
  fixup_enabled || { echo "rule off"; return 1; }
  git -C "$FIXUP_REPO" cat-file -e "$rv^{commit}" 2>/dev/null || { echo "reviewed commit ${rv:0:12} is not available locally"; return 1; }
  git -C "$FIXUP_REPO" cat-file -e "$hd^{commit}" 2>/dev/null || { echo "head ${hd:0:12} is not available locally"; return 1; }
  [[ "$rv" != "$hd" ]] || { echo "head is the reviewed commit"; return 1; }
  git -C "$FIXUP_REPO" merge-base --is-ancestor "$rv" "$hd" || { echo "reviewed commit is not an ancestor of the head"; return 1; }
  mb="$(git -C "$FIXUP_REPO" merge-base origin/main "$rv" 2>/dev/null)" || { echo "cannot find where the reviewed commit forked from origin/main"; return 1; }
  reviewed_files="$(git -C "$FIXUP_REPO" diff --name-only --no-renames "$mb" "$rv")" || { echo "cannot list the reviewed diff"; return 1; }
  read -ra tg <<<"$FIXUP_TEST_GLOBS"; read -ra dg <<<"$FIXUP_DOC_GLOBS"
  while IFS=$'\t' read -r meta path; do
    [[ -n "$meta" ]] || continue
    read -r om nm _ _ ost <<<"${meta#:}"
    [[ "$ost" == M && "$om" == "$nm" && "$nm" != 120000 && "$nm" != 160000 ]] || { echo "$path is not a plain modification (status $ost, mode $om->$nm)"; return 1; }
    grep -Fxq -- "$path" <<<"$reviewed_files" || { echo "$path was not part of the reviewed diff"; return 1; }
    ok=0; for pat in "${tg[@]}" "${dg[@]}"; do [[ -n "$pat" && "$path" == $pat ]] && { ok=1; break; }; done
    [[ $ok -eq 1 ]] || { echo "$path matches no fix-up test or doc glob"; return 1; }
    files="${files:+$files,}$path"; n=$((n+1))
  done < <(git -C "$FIXUP_REPO" diff --raw --no-renames "$rv" "$hd")
  [[ $n -gt 0 ]] || { echo "no file changes between the reviewed commit and the head"; return 1; }
  # capture first: a failed diff must not look like "0 changed lines" (fail closed = needs a fresh review)
  numstat="$(git -C "$FIXUP_REPO" diff --numstat --no-renames "$rv" "$hd")" || { echo "cannot count the changed lines (git diff --numstat failed)"; return 1; }
  while IFS=$'\t' read -r add del path; do
    [[ -n "$add" ]] || continue
    [[ "$add" =~ ^[0-9]+$ && "$del" =~ ^[0-9]+$ ]] || { echo "$path is binary"; return 1; }
    lines=$((lines + add + del))
  done <<<"$numstat"
  [[ $lines -le $FIXUP_MAX_LINES ]] || { echo "$lines changed lines exceed the cap of $FIXUP_MAX_LINES"; return 1; }
  echo "$files"
}
# verify_reviewed <entry file> <PR head now>: run-time re-check of the reviewed-sha gate. rc 0 ok, 29 refused. The PR head must be the
# reviewed commit recorded at `add`, or a commit this runner pushed itself (recorded as `pushed:` lines, so transient retries work).
verify_reviewed() {
  local f="$1" cur="$2" rv pr; rv="$(f_get "$f" reviewed)"; pr="$(f_get "$f" pr)"
  case "$rv" in
    "") [[ "$REQUIRE_REVIEW" == 0 ]] && return 0
        echo "REFUSED: queue entry for PR $pr records no review (queued before reviews were recorded). Re-add it after a kotone-reviewer pass."; return 29 ;;
    OFF) [[ "$REQUIRE_REVIEW" == 0 ]] && return 0
        echo "REFUSED: PR $pr was queued while the review gate was off, and it is on now. Re-add it after a kotone-reviewer pass."; return 29 ;;
    WAIVED) return 0 ;;
  esac
  [[ "$cur" =~ ^[0-9a-f]{40}$ ]] || { echo "REFUSED: cannot read the current head of PR $pr from GitHub (got: ${cur:0:80}); not merging unreviewed code."; return 29; }
  [[ "$cur" == "$rv" ]] && return 0
  grep -Fxq -- "pushed: $cur" "$f" && return 0
  local base fx; base="$(f_get "$f" review-base)"; [[ -n "$base" ]] || base="$rv"
  if fx="$(fixup_ok "$base" "$cur")"; then
    echo "review of PR $pr kept by fix-up rule: $fx (reviewed $base, head $cur)"
    [[ -z "$FIXUP_NOTE" ]] || echo "$pr: $fx" >>"$FIXUP_NOTE"
    return 0
  fi
  echo "REFUSED: PR $pr head is $cur but the reviewed commit is $rv: new commits after it was queued. Get a fresh 'reviewed <sha>' comment and re-add the PR."
  fixup_enabled && echo "(fix-up rule did not apply: $fx)"
  return 29
}
# norm_deploy <value>: prints yes|no for yes|no|deploy:yes|deploy:no (case-insensitive), rc 1 for anything else.
norm_deploy() {
  case "${1,,}" in yes|deploy:yes) echo yes ;; no|deploy:no) echo no ;; *) return 1 ;; esac
}
# fast_stamp_gate <pr>: with KOTONE_MQ_REQUIRE_FAST_STAMP=1 the PR's current head must carry the stamp `check.sh --fast` writes.
fast_stamp_gate() {
  local pr="$1" head
  [[ "$REQUIRE_FAST_STAMP" == 1 ]] || return 0
  head="$("$GH" pr view "$pr" --json headRefOid -q .headRefOid 2>&1)" || { echo "REFUSED: cannot read the head of PR $pr from GitHub to look for the fast-check stamp: $head"; return 1; }
  [[ "$head" =~ ^[0-9a-f]{40}$ ]] || { echo "REFUSED: GitHub did not return a 40-char head commit for PR $pr (got: ${head:0:80})"; return 1; }
  [[ -e "$OPS_DIR/fast-ok-$head" ]] || {
    echo "REFUSED: no fast-check stamp for the head of PR $pr ($head). In the task worktree, on that exact pushed commit with a clean tree, run: scripts/check.sh --fast (it writes $OPS_DIR/fast-ok-$head), then add again."; return 1; }
}
# add_hook <pr> <id> <worktree>: the queue-time refusals of ops/hooks/mq-add (absent = no-op). rc 0 ok, 1 refused (reason printed).
add_hook() {
  local pr="$1" id="$2" wt="$3" h out hrc=0
  if h="$(find_hook mq-add "$wt")"; then
    out="$(cd "$wt" && KOTONE_PR="$pr" KOTONE_TASK_ID="$id" KOTONE_WORKTREE="$wt" KOTONE_OPS_DIR="$OPS_DIR" "$h" "$pr" "$id" 2>&1)" || hrc=$?
    if [[ $hrc -ne 0 ]]; then echo "REFUSED: ops/hooks/mq-add refused PR $pr (rc=$hrc)"; [[ -z "$out" ]] || echo "$out"; return 1; fi
    [[ -z "$out" ]] || echo "$out"
  fi
  return 0
}
# readd_queued <pr> <task> <agent> <deploy> <entry file>: `add` for a PR that is already queued (caller holds the lock). It only ever
# refreshes the recorded reviewed commit (and its fix-up base), using exactly the checks a first add makes for the PR's CURRENT head
# (review_gate, fast stamp, mq-add hook). Position, hold state, task, agent, deploy flag and every other line stay as they are; a
# differing task, agent or deploy flag is refused, and an entry the runner holds (merging) is never touched.
readd_queued() {
  local pr="$1" id="$2" agent="$3" deploy="$4" f="$5" gout cid cag cdep cst old wt k tag="PR $pr already queued"
  cid="$(f_get "$f" task)"; cag="$(f_get "$f" agent)"; cdep="$(norm_deploy "$(f_get "$f" deploy)" || echo "?")"
  if [[ "$id" != "$cid" || "$agent" != "$cag" || "$deploy" != "$cdep" ]]; then
    echo "REFUSED: $tag as task $cid, agent $cag, deploy $cdep; you gave task $id, agent $agent, deploy $deploy. Nothing changed (the lead changes those with remove + add)."
    return 1
  fi
  cst="$(get_state "$cid")"
  if [[ "$cst" == merging ]]; then echo "REFUSED: $tag and the runner holds it (merging) now; its entry is not modified."; return 1; fi
  if [[ "$cst" != queued && "$cst" != legacy ]]; then echo "REFUSED: $tag but task $cid is $cst, not queued; nothing changed."; return 1; fi
  old="$(f_get "$f" reviewed)"
  gout="$OPS_DIR/.rg.$$"
  if ! review_gate "$pr" >"$gout"; then
    if [[ "$REVIEW_HEAD" =~ ^[0-9a-f]{40}$ ]] && grep -Fxq -- "pushed: $REVIEW_HEAD" "$f"; then
      rm -f "$gout"
      echo "$tag: nothing changed (the head is a commit the queue pushed itself; the recorded review ${old:0:12} stands), position $(q_sorted | grep -nFx -- "$f" | cut -d: -f1)"; return 0
    fi
    if [[ -n "$old" && "$old" == "$REVIEW_HEAD" ]]; then
      rm -f "$gout"
      echo "$tag: nothing changed (reviewed commit ${old:0:12} is the current head), position $(q_sorted | grep -nFx -- "$f" | cut -d: -f1)"; return 0
    fi
    cat "$gout"; rm -f "$gout"
    if [[ "$REVIEW_HEAD" =~ ^[0-9a-f]{40}$ ]]; then
      echo "$tag: nothing changed. The recorded review (${old:0:12}) is for an older head; the head is now $REVIEW_HEAD. Get a comment exactly 'reviewed $REVIEW_HEAD', then run add again."
    else
      echo "$tag: nothing changed (the review check could not run, see above)."
    fi
    return 1
  fi
  cat "$gout"; rm -f "$gout"
  k="$(q_sorted | grep -nFx -- "$f" | cut -d: -f1)"
  if [[ "$REVIEWED_SHA" == "$old" && "$REVIEW_BASE" == "$(f_get "$f" review-base)" ]]; then
    echo "$tag: nothing changed (reviewed commit ${old:0:12} is current), position $k"; return 0
  fi
  fast_stamp_gate "$pr" || { echo "$tag: nothing changed."; return 1; }
  wt="$(f_get "$(claim_file "$cid")" worktree)"; [[ -n "$wt" && -d "$wt" ]] || wt="$MAIN_WT"
  add_hook "$pr" "$cid" "$wt" || { echo "$tag: nothing changed."; return 1; }
  f_set "$f" reviewed "$REVIEWED_SHA" || { echo "$tag: cannot update the entry; nothing changed."; return 1; }
  if [[ -n "$REVIEW_BASE" ]]; then f_set "$f" review-base "$REVIEW_BASE" && f_set "$f" fixup "$REVIEW_FIXUP"
  else f_del "$f" review-base && f_del "$f" fixup; fi || { echo "ERROR: $tag, reviewed updated but the fix-up lines could not be reset; check the entry"; return 1; }
  echo "$tag: reviewed commit updated ${old:0:12} -> ${REVIEWED_SHA:0:12}, position $k"
}
do_add() {
  local pr="$1" id="$2" agent="$3" deploy="$4" prio="$5" st last n f wt k arr=() e
  deploy="$(norm_deploy "$deploy")" || { echo "REFUSED: deploy flag '$4' is not one of yes|no|deploy:yes|deploy:no (nothing queued)"; return 1; }
  if f="$(qfile "$pr")"; then readd_queued "$pr" "$id" "$agent" "$deploy" "$f"; return; fi
  [[ -e "$(claim_file "$id")" ]] || { echo "REFUSED: no claim for task $id (task.sh list)"; return 1; }
  st="$(get_state "$id")"
  [[ "$st" == started || "$st" == failed || "$st" == legacy ]] || { echo "REFUSED: task $id is $st, must be started"; return 1; }
  review_gate "$pr" || return 1
  fast_stamp_gate "$pr" || return 1
  wt="$(f_get "$(claim_file "$id")" worktree)"; [[ -n "$wt" && -d "$wt" ]] || wt="$MAIN_WT"
  add_hook "$pr" "$id" "$wt" || return 1
  last="$(q_sorted | tail -1)"; n=1; [[ -n "$last" ]] && n=$(( $(f_get "$last" order) + 1 ))
  f="$OPS_DIR/queue/pr$pr"; [[ -e "$f" ]] && f="$f.$(date +%s%N)"
  printf 'pr: %s\ntask: %s\nagent: %s\ndeploy: %s\nqueued: %s\norder: %s\nreviewed: %s\n' "$pr" "$id" "$agent" "$deploy" "$(date -Is)" "$n" "$REVIEWED_SHA" | atomic_write "$f"
  [[ -z "$REVIEW_BASE" ]] || { f_set "$f" review-base "$REVIEW_BASE"; f_set "$f" fixup "$REVIEW_FIXUP"; }
  if [[ "$prio" == yes ]]; then
    f_set "$f" priority yes
    # after the leading run of priority entries and entries the runner already holds (merging); ahead of everything else
    mapfile -t arr < <(q_sorted | grep -Fxv -- "$f"); k=0
    for e in "${arr[@]}"; do
      [[ "$(f_get "$e" priority)" == yes || "$(get_state "$(f_get "$e" task)")" == merging ]] || break
      k=$((k+1))
    done
    printf '%s\n' "${arr[@]:0:$k}" "$f" "${arr[@]:$k}" | sed '/^$/d' | q_renumber
  fi
  set_state "$id" queued "PR $pr" || { rm -f "$f"; return 1; }
  prio_note=""; [[ "$prio" != yes ]] || prio_note=", priority"
  echo "queued PR $pr (position $(q_sorted | grep -nFx -- "$f" | cut -d: -f1)${prio_note})"
}
do_hold() { local f; f="$(qfile "$1")" || { echo "PR $1 not in queue"; return 1; }
  [[ "$(get_state "$(f_get "$f" task)")" == merging ]] && { echo "PR $1 is merging now"; return 1; }
  f_set "$f" held yes && echo "held PR $1 (keeps position $(f_get "$f" order))"; }
do_unhold() { local f; f="$(qfile "$1")" || { echo "PR $1 not in queue"; return 1; }
  f_del "$f" held && echo "unheld PR $1 (back at position $(f_get "$f" order))"; }
do_move() {
  local f t pos="$2" n arr=() out=() i; t="$(qfile "$1")" || { echo "PR $1 not in queue"; return 1; }
  mapfile -t arr < <(q_sorted); n=${#arr[@]}
  [[ "$pos" =~ ^[0-9]+$ && $pos -ge 1 && $pos -le $n ]] || { echo "position must be 1..$n"; return 1; }
  for f in "${arr[@]}"; do [[ "$f" == "$t" ]] || out+=("$f"); done
  out=("${out[@]:0:$((pos-1))}" "$t" "${out[@]:$((pos-1))}")
  printf '%s\n' "${out[@]}" | q_renumber; echo "moved PR $1 to position $pos"
}
do_remove() { local f id; f="$(qfile "$1")" || { echo "PR $1 not in queue"; return 1; }
  id="$(f_get "$f" task)"; [[ "$(get_state "$id")" == merging ]] && { echo "PR $1 is merging now"; return 1; }
  rm -f "$f"; [[ "$(get_state "$id")" == queued ]] && set_state "$id" started "dequeued PR $1"; echo "removed PR $1 from the queue"; }
do_state() { set_state "$@"; }

# contained_reason <state> <head-branch> <head-oid>: run inside the mq worktree after `git fetch`. Prints why the PR adds nothing
# to origin/main (rc 0), else rc 1. Covers stacked/contained PRs: GitHub says MERGED, the head is an ancestor of main, or every
# commit on the head already has a patch-equivalent on main (`git cherry` shows no '+' lines, e.g. after a cherry-pick/squash).
contained_reason() {
  local st="$1" head="$2" oid="$3" ref="origin/$2"
  [[ "$st" == MERGED ]] && { echo "GitHub state is MERGED"; return 0; }
  if [[ -n "$oid" ]] && git cat-file -e "$oid^{commit}" 2>/dev/null; then
    git merge-base --is-ancestor "$oid" origin/main && { echo "head $oid is an ancestor of origin/main"; return 0; }
  fi
  git rev-parse -q --verify "$ref^{commit}" >/dev/null || return 1
  git merge-base --is-ancestor "$ref" origin/main && { echo "head $head is an ancestor of origin/main"; return 0; }
  git cherry origin/main "$ref" | grep -q '^+' || { echo "every commit of $head has a patch-equivalent on origin/main"; return 0; }
  return 1
}
# skip_contained <pr> <why>: record in the log, close the PR with a comment if GitHub still shows it open. Never fails the entry.
skip_contained() {
  local pr="$1" why="$2" st
  echo "SKIP: PR $pr already contained in main ($why); no check, no merge"
  st="$("$GH" pr view "$pr" --json state -q .state 2>/dev/null || true)"
  if [[ "$st" == OPEN ]]; then
    "$GH" pr close "$pr" --comment "Closed by the merge queue: this PR's changes are already contained in main ($why)." || echo "WARNING: could not close PR $pr"
  fi
}

# already_released <id>: rc 0 when the claim file is gone and done/<id>[.*] records state released (released by hand or earlier).
already_released() {
  local d; [[ ! -e "$(claim_file "$1")" ]] || return 1
  for d in "$OPS_DIR/done/$1" "$OPS_DIR/done/$1".*; do [[ -f "$d" ]] && grep -q '^state: released' "$d" && return 0; done
  return 1
}
# mark_merged <id> <note>: set state merged, tolerating an already-released claim (merge was good; nothing to record).
mark_merged() { already_released "$1" && return 0; locked set_state "$1" merged "$2" >/dev/null; }

# release_task <id> <note> <log>: absolute task.sh, run from the main checkout. Loud on failure; rc 0 only if released.
release_task() {
  local id="$1" note="$2" log="$3" out rc=0
  # Claim already released (by hand or an earlier run, after a good merge): nothing left to do, not a failure.
  if already_released "$id"; then
    echo "release $id: claim already released; nothing to do" >>"$log"; echo "claim $id already released; ok"; return 0
  fi
  out="$(cd "$MAIN_WT" && KOTONE_RUNNER_ROOT="$ROOT" "$TASKSH" release "$id" --merged "$note" 2>&1)" || rc=$?
  { echo "release $id (rc=$rc): $out"; } >>"$log"
  if [[ $rc -ne 0 ]]; then echo "RELEASE FAILED for task $id (rc=$rc): $out" >&2; echo "RELEASE FAILED for task $id (rc=$rc): $out"; return "$rc"; fi
  grep -h WARNING <<<"$out" || true
}

# run_premerge <batch 0|1> <pr...>: optional ops/hooks/mq-pre-merge in the queue worktree (cwd). rc 0 ok/absent, 24 hook failed,
# 25 hook left the tree dirty. The caller checks that HEAD still descends from the pre-hook commit.
run_premerge() {
  local b="$1" h hrc=0 st; shift
  h="$(find_hook mq-pre-merge "$MQ")" || return 0
  echo "running ops/hooks/mq-pre-merge for PR(s) $* (batch=$b)"
  KOTONE_PR_LIST="$*" KOTONE_BATCH="$b" KOTONE_OPS_DIR="$OPS_DIR" "$h" "$@" || hrc=$?
  [[ $hrc -eq 0 ]] || { echo "PRE-MERGE HOOK FAILED (rc=$hrc): not checking, pushing or merging"; return 24; }
  st="$(git status --porcelain)" || { echo "git status failed after the pre-merge hook"; return 25; }
  [[ -z "$st" ]] || { echo "PRE-MERGE HOOK left uncommitted or untracked changes (it must commit its output):"; echo "$st"; return 25; }
  return 0
}

# record_checked: remember the tree of the commit the queue just fully checked (HEAD, after clean_after_check). KOTONE_MQ_DEPLOY_CHECK=none
# compares origin/main's tree to it before deploying.
record_checked() { git rev-parse 'HEAD^{tree}' | atomic_write "$OPS_DIR/checked-tree"; }
# deploy_prod: production deploy of origin/main from the queue worktree. Plain command; callers read $? (set +e around it).
# KOTONE_MQ_DEPLOY_CHECK: fast (default) = check.sh --fast on origin/main, full = scripts/check.sh, none = no re-check but origin/main's tree
# must equal the tree the queue fully checked (else refuse). KOTONE_MQ_DEPLOY_ARG (default production) is deploy.sh's first argument.
deploy_prod() {
  (
    set -e; cd "$MQ"; git fetch -q origin; git checkout -q --detach origin/main
    case "$DEPLOY_CHECK" in
      fast) KOTONE_MQ=1 ./scripts/check.sh --fast || { echo "DEPLOY CHECK FAILED"; exit 1; } ;;
      full) KOTONE_MQ=1 ./scripts/check.sh || { echo "DEPLOY CHECK FAILED"; exit 1; } ;;
      none) want="$(cat "$OPS_DIR/checked-tree" 2>/dev/null || true)"; have="$(git rev-parse 'origin/main^{tree}')"
        [[ -n "$want" ]] || { echo "DEPLOY REFUSED: KOTONE_MQ_DEPLOY_CHECK=none but no checked tree is recorded"; exit 1; }
        [[ "$have" == "$want" ]] || { echo "DEPLOY REFUSED: origin/main tree $have is not the tree the queue checked ($want); main moved, deploy by hand after a check"; exit 1; } ;;
      *) echo "DEPLOY REFUSED: unknown KOTONE_MQ_DEPLOY_CHECK='$DEPLOY_CHECK' (fast|full|none)"; exit 1 ;;
    esac
    if [[ -n "${KOTONE_MQ_DRYRUN:-}" ]]; then echo "DRYRUN: would deploy $DEPLOY_ARG"; exit 0; fi
    ./scripts/deploy.sh "$DEPLOY_ARG"
  )
}

# batch_guard <i>: tree-equality guard for batch entry i (0-based); needs BASE, pushed[], heads, H, HT from batch_body. Fresh fetch,
# then main must be exactly what we expect, and merging the head into it must give exactly the head's tree. rc 0 only if all hold.
batch_guard() {
  local i="$1" p="${pushed[$1]}" fresh want
  git fetch -q origin || { echo "GUARD: cannot fetch origin"; return 30; }
  if [[ $i -eq 0 ]]; then
    [[ "$(git rev-parse origin/main)" == "$BASE" ]] || { echo "GUARD: origin/main moved since the batch was assembled"; return 30; }
  else
    [[ "$(git rev-parse 'origin/main^{tree}')" == "$(git rev-parse "${pushed[$((i-1))]}^{tree}")" ]] \
      || { echo "GUARD: origin/main is not the tree of the previous batch head"; return 30; }
  fi
  want="$(git rev-parse "$p^{tree}")"
  fresh="$(git merge-tree --write-tree origin/main "$p" 2>/dev/null)" || { echo "GUARD: cannot recompute the merge tree (conflict or git too old)"; return 30; }
  [[ "$fresh" == "$want" ]] || { echo "GUARD: tree after merging into origin/main ($fresh) differs from the checked head ($want)"; return 30; }
  if [[ $i -eq $(( ${#pushed[@]} - 1 )) ]]; then
    [[ "$p" == "$H" && "$want" == "$HT" ]] || { echo "GUARD: last head is not the checked commit"; return 30; }
  fi
  return 0
}

# single_guard <base> <oid>: guard for the single flow, run right before every merge attempt. Fresh fetch; origin/main must still be
# exactly <base> (the main that was merged in and checked) and merging <oid> into it must give exactly <oid>'s tree.
# rc 0 ok; 31 main moved (caller restarts the entry from the top); 30 anything else (stop).
single_guard() {
  local base="$1" oid="$2" fresh
  git fetch -q origin || { echo "GUARD: cannot fetch origin"; return 30; }
  [[ "$(git rev-parse origin/main)" == "$base" ]] || { echo "GUARD: origin/main moved since it was merged in and checked (was $base)"; return 31; }
  fresh="$(git merge-tree --write-tree origin/main "$oid" 2>/dev/null)" || { echo "GUARD: cannot recompute the merge tree"; return 30; }
  [[ "$fresh" == "$(git rev-parse "$oid^{tree}")" ]] || { echo "GUARD: tree after merging into origin/main ($fresh) differs from the checked head"; return 30; }
  return 0
}
# clean_after_check: the full check must leave HEAD and the tree exactly as they were. rc 0 ok, 27 HEAD moved, 25 git status failed, 32 dirty.
clean_after_check() {
  local want="$1" st
  [[ "$(git rev-parse HEAD)" == "$want" ]] || { echo "check.sh moved HEAD; aborted"; return 27; }
  st="$(git status --porcelain)" || { echo "git status failed after the check"; return 25; }
  [[ -z "$st" ]] || { echo "check.sh left uncommitted or untracked changes; aborted (the checked tree must be exactly what is pushed):"; echo "$st"; return 32; }
  return 0
}
# batch_restore: EXIT trap of the batch subshell. After a failed batch, put every PR head that we pushed and that is not merged back to
# the sha it had before (force-with-lease on OUR pushed commit only), so a later single cannot carry another PR's commits into main.
# A head that cannot be restored is listed in <merged-file>.restorefail; the caller then fails the entries instead of falling back.
batch_restore() {
  local i pr remote
  for i in "${attempted[@]}"; do
    pr="${prs[i]}"
    if grep -Fxq -- "$pr" "$BF" 2>/dev/null; then continue; fi
    remote="$(git ls-remote origin "refs/heads/${heads[i]}" 2>/dev/null | cut -f1)" || remote=""
    if [[ "$remote" == "${orig[i]}" ]]; then continue; fi
    if [[ "$remote" == "${pushed[i]}" ]] && KOTONE_MQ=1 git push -q --force-with-lease="refs/heads/${heads[i]}:${pushed[i]}" origin "${orig[i]}:refs/heads/${heads[i]}"; then
      echo "RESTORED the head of PR $pr (${heads[i]}) to ${orig[i]}"
    else
      echo "RESTORE FAILED: PR $pr (${heads[i]}) is at '${remote:-?}', expected ${pushed[i]}; could not put back ${orig[i]}"; echo "$pr" >>"$BF.restorefail"
    fi
  done
  return 0
}
# batch_body <merged-file> <pr...>: the whole batch in the queue worktree (run it in a `( set -e; ... )` subshell). Appends each PR number
# to <merged-file> right after GitHub merged it. Exit codes: 20 not open/contained/stale, 21 conflict, 24/25/26 hook, 27 check altered HEAD,
# 28 push, 30 guard, check/merge rc otherwise. Nonzero always means "fall back to singles" for whatever is not in <merged-file>.
batch_body() {
  BF="$1"; shift
  local n=$# i pr info pst head hoid why pre rc
  # globals (not local): batch_restore runs as the EXIT trap of this subshell and needs them
  prs=("$@"); heads=(); cs=(); pushed=(); orig=(); attempted=()
  cd "$MQ"; git fetch -q origin
  git checkout -q -f --detach origin/main; git reset -q --hard; git clean -fdq
  BASE="$(git rev-parse origin/main)"
  for ((i=0; i<n; i++)); do
    pr="${prs[i]}"
    info="$("$GH" pr view "$pr" --json state,headRefName,headRefOid -q '[.state,.headRefName,.headRefOid]|@tsv' 2>/dev/null || true)"
    IFS=$'\t' read -r pst head hoid <<<"$info"
    [[ "$pst" == OPEN && -n "$head" ]] || { echo "PR $pr is not open (state=${pst:-?}); batch aborted"; exit 20; }
    if why="$(contained_reason "$pst" "$head" "$hoid")"; then echo "PR $pr looks contained in main ($why); batch aborted"; exit 20; fi
    git rev-parse -q --verify "origin/$head^{commit}" >/dev/null || { echo "origin/$head not found; batch aborted"; exit 20; }
    [[ -z "$hoid" || "$(git rev-parse "origin/$head")" == "$hoid" ]] || { echo "PR $pr: GitHub head $hoid != fetched origin/$head; batch aborted"; exit 20; }
    verify_reviewed "${BFILES[i]}" "$hoid" || exit 29
    heads+=("$head"); orig+=("$(git rev-parse "origin/$head")")
    git merge -q --no-edit "origin/$head" || { git merge --abort 2>/dev/null || true; echo "CONFLICT merging PR $pr ($head) into the batch"; exit 21; }
    cs+=("$(git rev-parse HEAD)")
    if [[ $i -gt 0 && "${cs[i]}" == "${cs[i-1]}" ]]; then echo "PR $pr adds nothing to the batch; batch aborted"; exit 20; fi
  done
  pre="${cs[n-1]}"
  run_premerge 1 "${prs[@]}" || exit $?
  git merge-base --is-ancestor "$pre" HEAD || { echo "PRE-MERGE HOOK moved HEAD off the assembled batch"; exit 26; }
  H="$(git rev-parse HEAD)"; HT="$(git rev-parse 'HEAD^{tree}')"
  cst0=$SECONDS
  KOTONE_MQ=1 ./scripts/check.sh || { rc=$?; echo "$((SECONDS - cst0))" >"$BF.check"; echo "CHECK FAILED (rc=$rc): not pushing or merging"; exit "$rc"; }
  echo "$((SECONDS - cst0))" >"$BF.check"
  clean_after_check "$H" || exit $?
  record_checked
  echo "batch checked: $H (tree $HT)"
  if [[ -n "${KOTONE_MQ_DRYRUN:-}" && "${KOTONE_MQ_DRYRUN:-}" != gh ]]; then
    echo "DRYRUN: would push the batch heads and gh pr merge ${prs[*]}"; printf '%s\n' "${prs[@]}" >>"$BF"; exit 0; fi
  for ((i=0; i<n-1; i++)); do pushed+=("${cs[i]}"); done; pushed+=("$H")
  # each pushed sha is recorded in its entry first: run-time review verification accepts the runner's own pushed heads (retries)
  for ((i=0; i<n; i++)); do locked f_append "${BFILES[i]}" "pushed: ${pushed[i]}" || { echo "cannot record pushed head"; exit 28; }; done
  trap batch_restore EXIT
  batch_guard 0 || exit 30
  for ((i=0; i<n; i++)); do
    if [[ "${KOTONE_MQ_DRYRUN:-}" == gh ]]; then echo "DRYRUN(gh): skipping push of ${pushed[i]}"
    else attempted+=("$i"); KOTONE_MQ=1 git push -q origin "${pushed[i]}:refs/heads/${heads[i]}" || { echo "PUSH FAILED for PR ${prs[i]}"; exit 28; }; fi
  done
  for ((i=0; i<n; i++)); do
    batch_guard "$i" || exit 30
    wait_mergeable "${prs[i]}" "${pushed[i]}" || { rc=$?; exit "$rc"; }
    merge_pr "${prs[i]}" "${pushed[i]}" batch_guard "$i" || { rc=$?; exit "$rc"; }
    echo "${prs[i]}" >>"$BF"; echo "${prs[i]} ${pushed[i]}" >>"$BF.sha"
  done
}

# finish_merged <queue-file> <note> <log>: bookkeeping for an entry merged by a batch (state, done file, release).
finish_merged() {
  local f="$1" note="$2" log="$3" pr id line dep; pr="$(f_get "$f" pr)"; id="$(f_get "$f" task)"
  dep="$(norm_deploy "$(f_get "$f" deploy)" || f_get "$f" deploy)"
  line="$(mqlog_line "$f" "$B_START" merged - "$B_ID" "$B_SIZE" "$(sed -n "s/^$pr //p" "$B_BF.sha" 2>/dev/null | tail -1)" "$dep" - "$(cat "$B_BF.check" 2>/dev/null || true)" "$(fixup_note_of "$FIXUP_NOTE" "$pr" "$f")")"
  if [[ "$dep" == yes && $BATCH -gt 1 ]]; then pending_logs+=("$line"); else mqlog_emit "$line"; fi
  mark_merged "$id" "PR $pr ($note)" || relfail=1
  { cat "$f"; echo "result: merged ($note)"; echo "finished: $(date -Is)"; echo "log: $log"; } | atomic_write "$f"
  mv -f "$f" "$OPS_DIR/done/pr$pr-$(date +%s%N)"
  release_task "$id" "PR $pr merged ($note)" "$log" || { relfail=1; echo "PR $pr: merged ($note), RELEASE FAILED"; return 0; }
  echo "PR $pr: merged ($note)"
}

# fail_entry <queue-file> <result> <log>: claim -> failed, entry -> done with the result (claim and PR stay for the lead).
fail_entry() {
  local f="$1" res="$2" log="$3" pr id; pr="$(f_get "$f" pr)"; id="$(f_get "$f" task)"
  mqlog_emit "$(mqlog_line "$f" "$B_START" refused "$res" "$B_ID" "$B_SIZE" - "$(f_get "$f" deploy)" - "$(cat "$B_BF.check" 2>/dev/null || true)" -)"
  locked set_state "$id" failed "PR $pr: $res" >/dev/null || true
  { cat "$f"; echo "result: $res"; echo "finished: $(date -Is)"; echo "log: $log"; } | atomic_write "$f"
  mv -f "$f" "$OPS_DIR/done/pr$pr-$(date +%s%N)"
}
# try_batch <queue-file...>: one batch attempt. Entries it merged are finalized; every other entry goes back to `queued` and is flagged
# in $nobatch so the main loop processes it as a single.
try_batch() {
  local files=("$@") prs=() ids=() fl i j bf blog rc emsg
  for fl in "${files[@]}"; do prs+=("$(f_get "$fl" pr)"); ids+=("$(f_get "$fl" task)"); done
  blog="$LOGS/batch-$(IFS=-; echo "${prs[*]}")-$(date +%s).log"; bf="$blog.merged"; : >"$bf"
  B_START="$(date +%s)"; B_BF="$bf"; B_SIZE="${#prs[@]}"; B_ID="batch-${prs[0]}-$B_START"; FIXUP_NOTE="$bf.fixup"
  echo "== BATCH of ${#prs[@]}: PRs ${prs[*]}, log: $blog"
  for i in "${!ids[@]}"; do
    if ! locked set_state "${ids[i]}" merging "batch PR ${prs[i]}" >/dev/null; then
      for ((j=0; j<i; j++)); do locked set_state "${ids[j]}" queued "batch not started" >/dev/null || true; done
      nobatch="$nobatch ${files[*]}"; echo "batch not started (cannot mark task ${ids[i]} merging); falling back to singles"; return 0
    fi
  done
  BFILES=("${files[@]}")
  set +e; ( set -e; batch_body "$bf" "${prs[@]}" ) >"$blog" 2>&1; rc=$?; set -e
  for i in "${!files[@]}"; do
    if grep -Fxq -- "${prs[i]}" "$bf"; then
      finish_merged "${files[i]}" "batch of ${#prs[@]}" "$blog"
      [[ "$deploy_of_batch" == yes ]] && want_deploy=1
    elif [[ -s "$bf.restorefail" ]]; then
      # a pushed head could not be restored: a later single could carry other PRs' commits into main, so nothing here may run again
      fail_entry "${files[i]}" "failed (batch failed and the pushed PR heads could not all be restored; see $blog)" "$blog"
      emsg="ERROR: PR ${prs[i]} FAILED: the batch failed after pushing and its PR heads could not all be restored (see $blog). Lead: inspect the PR branches before re-queueing."
      echo "$emsg"; echo "$emsg" >&2
    else
      locked set_state "${ids[i]}" queued "batch fell back to singles" >/dev/null || true
      nobatch="$nobatch ${files[i]}"
    fi
  done
  if [[ $rc -ne 0 ]]; then echo "BATCH FAILED (rc=$rc), falling back to singles for the entries not merged; log tail:"; tail -12 "$blog"; fi
}

# ---- run log (see header) ---------------------------------------------------------------------
# Fields are tab separated and never empty ("-" = none), so a line can be split on tabs safely.
lg_clean() { local v="${1:-}"; v="${v//[$'\t\r\n']/ }"; v="${v:0:${2:-200}}"; echo "${v:--}"; }
# mqlog_line <queue file> <started epoch> <result> <cause> <batch id> <batch size> <sha> <deploy> <deploy secs> <check secs> <note>: prints the line.
mqlog_line() {
  local f="$1" st="$2" ae w="" added; added="$(f_get "$f" queued)"
  ae="$(date -d "$added" +%s 2>/dev/null || true)"; [[ -z "$ae" ]] || { w=$((st - ae)); [[ $w -ge 0 ]] || w=0; }
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -Is)" "$(f_get "$f" pr)" "$(f_get "$f" task)" "$(lg_clean "$(f_get "$f" agent)" 60)" \
    "$(lg_clean "$added")" "$(date -d "@$st" -Is)" "$(lg_clean "$w")" "$(lg_clean "${10}" 12)" "$(lg_clean "$3" 30)" "$(lg_clean "$4" 160)" "$(lg_clean "$5" 80)" "$(lg_clean "$6" 6)" \
    "$(lg_clean "$7" 40)" "$(lg_clean "$8" 6)" "$(lg_clean "$9" 12)" "$(lg_clean "${11}" 1000)"
}
mqlog_emit() { mkdir -p "$(dirname "$MQLOG")" && printf '%s\n' "$1" >>"$MQLOG" || echo "WARNING: cannot append to the run log $MQLOG" >&2; }
# failure_cause <log file> <fallback>: the last decisive line of an entry's log, short.
failure_cause() {
  local c=""; [[ -f "$1" ]] && c="$(grep -E '^(CHECK FAILED|CONFLICT|REFUSED|GUARD|PUSH FAILED|MERGE FAILED|PRE-MERGE|TIMEOUT|PR [0-9]+ (is|adds)|ERROR|DEPLOY)' "$1" | tail -1 || true)"
  echo "${c:-$2}"
}
# classify_result <rc> <log file>: prints the run-log result word for a failed entry.
classify_result() {
  local rc="$1" lg="$2"
  if [[ -f "$lg" ]] && grep -q 'CHECK FAILED' "$lg"; then echo check-failed
  elif [[ -f "$lg" ]] && grep -q 'new commits after it was queued' "$lg"; then echo review-stale
  elif [[ -f "$lg" ]] && grep -q 'CONFLICT' "$lg"; then echo conflict
  elif [[ "$rc" == 5 || "$rc" == 21 || "$rc" == 4 ]] && [[ -f "$lg" ]] && grep -q 'conflict\|CONFLICT' "$lg"; then echo conflict
  else echo refused; fi
}
# fixup_note_of <note file> <pr> <entry file>: "review kept by fix-up rule: <files>" or "-" (run-time note wins over the one recorded at add).
fixup_note_of() {
  local nf="$1" pr="$2" f="$3" fx=""
  [[ -f "$nf" ]] && fx="$(grep "^$pr: " "$nf" | tail -1 | cut -d' ' -f2- || true)"
  [[ -n "$fx" ]] || fx="$(f_get "$f" fixup)"
  [[ -z "$fx" ]] || echo "review kept by fix-up rule: $fx"
}
# flush_pending <result override or ""> <deploy secs>: write the run-log lines held back until the one production deploy of a batch run.
flush_pending() {
  local l fl; local -a a
  for l in "${pending_logs[@]}"; do
    IFS=$'\t' read -ra a <<<"$l"; a[14]="$2"
    if [[ -n "$1" ]]; then a[8]="$1"; a[9]="deploy rc=$3"; fi
    fl="$(IFS=$'\t'; echo "${a[*]}")"; mqlog_emit "$fl"
  done
  pending_logs=()
}
do_log() {
  local since="" se=0 n=0 m=0 t=0 l ft
  while [[ $# -gt 0 ]]; do case "$1" in
    --since) since="${2:-}"; shift 2 || true ;;
    *) echo "usage: mq.sh log [--since <date>]"; return 2 ;; esac; done
  [[ -z "$since" ]] || se="$(date -d "$since" +%s 2>/dev/null)" || { echo "cannot read the date '$since'"; return 2; }
  [[ -s "$MQLOG" ]] || { echo "run log empty ($MQLOG)"; return 0; }
  printf '# finished\tpr\ttask\tagent\tadded\tstarted\twait_s\tcheck_s\tresult\tcause\tbatch_id\tbatch_size\tmerged_sha\tdeploy\tdeploy_s\treview_note\n'
  local sel; sel="$(mktemp)"
  while IFS= read -r l; do
    [[ -n "$l" ]] || continue
    ft="$(date -d "${l%%$'\t'*}" +%s 2>/dev/null || echo 0)"
    [[ $ft -ge $se ]] && printf '%s\n' "$l"
  done <"$MQLOG" >"$sel"
  cat "$sel"
  n="$(wc -l <"$sel")"
  if [[ $n -eq 0 ]]; then echo "summary: 0 entries${since:+ since $since}"; rm -f "$sel"; return 0; fi
  med() { cut -f"$1" "$sel" | grep -E '^[0-9]+$' | sort -n | awk '{a[NR]=$1} END{if(!NR) print "n/a"; else if(NR%2) print a[(NR+1)/2] "s"; else print int((a[NR/2]+a[NR/2+1])/2) "s"}'; }
  m="$(cut -f9 "$sel" | grep -c '^merged$' || true)"; t="$(cut -f9 "$sel" | grep -c '^transient$' || true)"
  awk -F'\t' -v n="$n" -v m="$m" -v t="$t" -v w="$(med 7)" -v c="$(med 8)" -v s="${since:+ since $since}" 'BEGIN{
    f = n - m - t; d = n - t
    printf "summary: %d entries%s (%d merged, %d failed, %d retried), median wait %s, median check %s, failure rate %s\n", n, s, m, f, t, w, c, (d ? sprintf("%.0f%% (%d of %d)", 100*f/d, f, d) : "n/a") }'
  rm -f "$sel"
}

case "$cmd" in
  add)
    prio=no; [[ "${KOTONE_MQ_PRIORITY:-}" == 1 ]] && prio=yes; pos=()
    for a in "$@"; do if [[ "$a" == --priority ]]; then prio=yes; else pos+=("$a"); fi; done
    [[ ${#pos[@]} -ge 3 && ${#pos[@]} -le 4 ]] || { sed -n '2,5p' "$0"; exit 2; }
    locked do_add "${pos[0]}" "${pos[1]}" "${pos[2]}" "${pos[3]:-yes}" "$prio" ;;
  log) do_log "$@" ;;
  hold) locked do_hold "$1" ;;
  unhold) locked do_unhold "$1" ;;
  move) locked do_move "$1" "$2" ;;
  remove) locked do_remove "$1" ;;
  list)
    mapfile -t q < <(q_sorted); [[ ${#q[@]} -eq 0 ]] && { echo "queue empty"; exit 0; }
    i=0; held=()
    for f in "${q[@]}"; do i=$((i+1))
      xp=""; [[ "$(f_get "$f" priority)" != yes ]] || xp=" | PRIORITY"
      xf="$(f_get "$f" fixup)"; [[ -z "$xf" ]] || xf=" | fix-up: $xf"
      line="#$i PR $(f_get "$f" pr) | task $(f_get "$f" task) | $(f_get "$f" agent) | deploy $(norm_deploy "$(f_get "$f" deploy)" || echo "INVALID:$(f_get "$f" deploy)") | $(get_state "$(f_get "$f" task)")${xp}${xf}"
      if [[ -n "$(f_get "$f" held)" ]]; then held+=("$line"); else echo "$line"; fi
    done
    if [[ ${#held[@]} -gt 0 ]]; then echo "-- held (skipped by run) --"; printf '%s\n' "${held[@]}"; fi ;;
  run)
    # One runner at a time, ever.
    exec 8>"$OPS_DIR/.runner"; flock -n 8 || { echo "another merge-queue run is active"; exit 1; }
    MQ="$WORKTREES/$SLUG-mq"
    [[ -d "$MQ" ]] || git worktree add -q --detach "$MQ" origin/main
    LOGS="$OPS_DIR/logs"; mkdir -p "$LOGS"
    relfail=0; skipped=""; nobatch=""; want_deploy=0; depfail=0; deploy_of_batch=""; pending_logs=(); FIXUP_REPO="$MQ"
    # Finalize claims a previous run marked merged but never released.
    for c in "$OPS_DIR"/claims/*; do
      cid="$(basename "$c")"
      if [[ "$(get_state "$cid")" == merged ]]; then
        echo "finalizing merged task $cid (previous run did not release it)"
        release_task "$cid" "finalized by later run" "$LOGS/finalize.log" || relfail=1
      fi
    done
    while :; do
      mapfile -t q < <(q_sorted); f=""; rl=()
      for c in "${q[@]}"; do
        [[ -n "$(f_get "$c" held)" ]] && continue
        [[ " $skipped " == *" $c "* ]] || rl+=("$c")
      done
      f="${rl[0]:-}"
      if [[ $BATCH -gt 1 && -n "$f" ]]; then
        grp=(); deploy_of_batch="$(norm_deploy "$(f_get "$f" deploy)" || echo INVALID)"
        [[ "$deploy_of_batch" == INVALID ]] || \
        for c in "${rl[@]}"; do
          [[ ${#grp[@]} -ge $BATCH ]] && break
          [[ " $nobatch " == *" $c "* ]] && break
          [[ "$(norm_deploy "$(f_get "$c" deploy)" || echo INVALID)" == "$deploy_of_batch" ]] || break
          case "$(get_state "$(f_get "$c" task)")" in queued|legacy) ;; *) break ;; esac
          grp+=("$c")
        done
        if [[ ${#grp[@]} -ge 2 ]]; then try_batch "${grp[@]}"; continue; fi
      fi
      [[ -n "$f" ]] || { [[ ${#q[@]} -eq 0 ]] && echo "queue empty" || echo "nothing runnable (held or retry-pending entries only)"; break; }
      pr="$(f_get "$f" pr)"; id="$(f_get "$f" task)"; deploy_raw="$(f_get "$f" deploy)"; deploy_bad=0
      deploy="$(norm_deploy "$deploy_raw")" || deploy_bad=1
      log="$LOGS/pr$pr-$(date +%s).log"; echo "== PR $pr (task $id), log: $log"
      t0="$(date +%s)"; FIXUP_NOTE="$log.fixup"; dsecs="-"
      result="merged"; rc=0; recovered=0
      cst="$(get_state "$id")"
      if [[ $deploy_bad -eq 1 ]]; then
        [[ "$cst" == queued || "$cst" == legacy ]] && { locked set_state "$id" merging "PR $pr invalid deploy value" >/dev/null || true; }
        rc=1; result="failed (invalid deploy value '$deploy_raw' in the queue entry; nothing merged; re-add with yes|no)"
        echo "ERROR: PR $pr: invalid stored deploy value '$deploy_raw'; refusing instead of silently skipping the deploy" | tee -a "$log"
      else case "$cst" in
        queued|legacy) locked set_state "$id" merging "PR $pr" >/dev/null || { rc=1; result="failed (cannot mark merging)"; } ;;
        merging)
          # A previous run died mid-merge. If GitHub says the PR is MERGED, finalize; otherwise retry.
          pst="$("$GH" pr view "$pr" --json state -q .state 2>/dev/null || true)"
          echo "recovering PR $pr: found merging entry, GitHub state=${pst:-?}" | tee -a "$log"
          [[ "$pst" == MERGED ]] && recovered=1 ;;
        *) rc=1; result="failed (claim of task $id is $cst, expected queued)" ;;
      esac; fi
      if [[ $rc -eq 0 && $recovered -eq 0 ]]; then
        # NOTE: never put these subshells on the left of ||, && or in an if: bash then ignores set -e inside.
        # Run them as plain commands with set +e around them and read $? afterwards.
        attempt=1
        while :; do
        set +e
        (
          set -e; cd "$MQ"
          git fetch -q origin
          info="$("$GH" pr view "$pr" --json state,headRefName,headRefOid -q '[.state,.headRefName,.headRefOid]|@tsv' 2>/dev/null || true)"
          IFS=$'\t' read -r pst head hoid <<<"$info"
          [[ -z "${KOTONE_MQ_HEAD:-}" ]] || head="$KOTONE_MQ_HEAD"
          verify_reviewed "$f" "$hoid" || exit 29
          [[ "$pst" == CLOSED ]] && { echo "PR $pr is closed (not merged)"; exit 3; }
          if [[ "$pst" != MERGED ]]; then [[ -n "$head" ]] || { echo "PR $pr is not open"; exit 3; }; fi
          if why="$(contained_reason "$pst" "$head" "$hoid")"; then skip_contained "$pr" "$why"; exit 10; fi
          git checkout -q -B "mq-$pr" "origin/$head"
          base="$(git rev-parse origin/main)"
          git merge -q --no-edit origin/main || {
            git merge --abort
            if why="$(contained_reason "$pst" "$head" "$hoid")"; then skip_contained "$pr" "$why"; exit 10; fi
            echo "CONFLICT merging main into $head"; exit 4; }
          pre="$(git rev-parse HEAD)"
          run_premerge 0 "$pr" || { rc=$?; exit "$rc"; }
          git merge-base --is-ancestor "$pre" HEAD || { echo "PRE-MERGE HOOK moved HEAD off the merged PR head"; exit 26; }
          oid="$(git rev-parse HEAD)"
          cst0=$SECONDS
          KOTONE_MQ=1 ./scripts/check.sh || { rc=$?; echo "$((SECONDS - cst0))" >"$log.check"; echo "CHECK FAILED (rc=$rc): not pushing or merging"; exit "$rc"; }
          echo "$((SECONDS - cst0))" >"$log.check"; echo "$oid" >"$log.sha"
          clean_after_check "$oid" || exit $?
          record_checked
          if [[ -n "${KOTONE_MQ_DRYRUN:-}" && "${KOTONE_MQ_DRYRUN:-}" != gh ]]; then echo "DRYRUN: would push HEAD:$head and gh pr merge $pr"; exit 0; fi
          locked f_append "$f" "pushed: $oid" || { echo "cannot record pushed head"; exit 28; }
          if [[ "${KOTONE_MQ_DRYRUN:-}" == gh ]]; then echo "DRYRUN(gh): skipping push of $oid"
          else KOTONE_MQ=1 git push -q origin "HEAD:$head" || { rc=$?; echo "PUSH FAILED"; exit "$rc"; }; fi
          single_guard "$base" "$oid" || exit $?
          wait_mergeable "$pr" "$oid" || { rc=$?; exit "$rc"; }
          merge_pr "$pr" "$oid" single_guard "$base" "$oid" || { rc=$?; exit "$rc"; }
        ) >>"$log" 2>&1
        rc=$?
        set -e
        if [[ $rc -eq 31 && $attempt -lt 3 ]]; then
          attempt=$((attempt+1)); echo "origin/main moved before the merge: restarting PR $pr from the top (attempt $attempt/3)" | tee -a "$log"; continue
        fi
        break
        done
      fi
      contained=0
      if [[ $rc -eq 10 ]]; then contained=1; rc=0; result="merged (already contained in main)"; fi
      [[ $rc -eq 0 ]] || result="failed (rc=$rc)"
      if [[ $rc -eq 75 ]]; then
        f_append "$f" "transient: $(date -Is)"
        if [[ $(grep -c '^transient: ' "$f") -lt 3 ]]; then
          mqlog_emit "$(mqlog_line "$f" "$t0" transient "merge not accepted yet" - 1 "$(cat "$log.sha" 2>/dev/null || true)" "${deploy:-$deploy_raw}" - "$(cat "$log.check" 2>/dev/null || true)" "$(fixup_note_of "$FIXUP_NOTE" "$pr" "$f")")"
          locked set_state "$id" queued "transient merge failure" >/dev/null || true
          echo "PR $pr: merge not accepted yet (transient); left in queue, re-run to retry"; tail -8 "$log"
          skipped="$skipped $f"; continue
        fi
        result="failed (transient merge failure, gave up after 3 runs)"
      fi
      if [[ $contained -eq 1 ]]; then mark_merged "$id" "PR $pr: already contained in main" || relfail=1
      elif [[ "$result" == merged ]]; then mark_merged "$id" "PR $pr" || relfail=1
      else locked set_state "$id" failed "PR $pr: $result" >/dev/null || true; fi
      if [[ "$result" == merged && "$deploy" == yes ]]; then
        if [[ $BATCH -gt 1 ]]; then want_deploy=1   # batch mode: one deploy per run, after the loop
        else
          d0="$(date +%s)"; set +e; deploy_prod >>"$log" 2>&1; drc=$?; set -e; dsecs=$(( $(date +%s) - d0 ))
          if [[ $drc -eq 0 ]]; then result="merged + deployed"; else result="merged, DEPLOY FAILED (rc=$drc)"; fi
        fi
      fi
      # run log line for this entry
      lres=merged; lcause="-"; lsha="$(cat "$log.sha" 2>/dev/null || true)"
      case "$result" in
        *"DEPLOY FAILED"*) lres=deploy-failed; lcause="deploy rc=$drc" ;;
        merged*) [[ $contained -eq 1 ]] && lcause="already contained in main"; [[ $recovered -eq 1 ]] && lcause="recovered after an interrupted run" ;;
        *) lres="$(classify_result "$rc" "$log")"; lcause="$(failure_cause "$log" "$result")"; lsha="" ;;
      esac
      lline="$(mqlog_line "$f" "$t0" "$lres" "$lcause" - 1 "$lsha" "${deploy:-$deploy_raw}" "$dsecs" "$(cat "$log.check" 2>/dev/null || true)" "$(fixup_note_of "$FIXUP_NOTE" "$pr" "$f")")"
      if [[ "$lres" == merged && "${deploy:-}" == yes && $BATCH -gt 1 ]]; then pending_logs+=("$lline"); else mqlog_emit "$lline"; fi
      rm -f "$log.check" "$log.sha" "$log.fixup"
      { cat "$f"; echo "result: $result"; echo "finished: $(date -Is)"; echo "log: $log"; } | atomic_write "$f"
      mv -f "$f" "$OPS_DIR/done/pr$pr-$(date +%s%N)"
      if [[ "$result" == merged* ]]; then
        release_task "$id" "PR $pr $result" "$log" || { relfail=1; result="$result, RELEASE FAILED"; }
      fi
      echo "PR $pr: $result"; [[ "$result" == merged* ]] || tail -25 "$log"
    done
    if [[ $want_deploy -eq 1 ]]; then
      dlog="$LOGS/deploy-$(date +%s).log"
      ds0="$(date +%s)"; set +e; deploy_prod >"$dlog" 2>&1; drc=$?; set -e; ds=$(( $(date +%s) - ds0 ))
      if [[ $drc -eq 0 ]]; then echo "DEPLOY: production deployed once for this run (log $dlog)"; flush_pending "" "$ds"
      else echo "DEPLOY FAILED (rc=$drc), log $dlog:"; tail -15 "$dlog"; depfail=1; flush_pending deploy-failed "$ds" "$drc"; fi
    fi
    flush_pending "" "-"
    [[ $relfail -eq 0 ]] || { echo "ERROR: one or more claims could not be released (see above); fix with task.sh release <id> --force"; exit 1; }
    [[ $depfail -eq 0 ]] || exit 1 ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac
