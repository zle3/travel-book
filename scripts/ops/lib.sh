# Shared helpers for task.sh and mq.sh. Source with:  . "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# Shared state lives in the git common dir, so every worktree sees the same task claims and
# merge queue, and none of it is ever committed.
#
# Everything is resolved from THIS file's location, never from the caller's cwd: a runner may be
# started inside a task worktree that later gets removed (that broke auto-release once).
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT="$(cd "$HERE/../.." && pwd -P)"
ORIG_PWD="$(pwd -P 2>/dev/null || true)"
cd "$ROOT"
shopt -s nullglob
# Project identity comes from ops/project.conf (KOTONE_SLUG=...), written by kotone-new.
[[ -f "$ROOT/ops/project.conf" ]] && . "$ROOT/ops/project.conf"
# Optional, for a project that adopted the framework with its own names (set in ops/project.conf):
#   KOTONE_OPS_DIRNAME    state dir under .git (default kotone-ops)
#   KOTONE_LEGACY_PREFIX  e.g. PTAI: every PTAI_<X> env var is also read as KOTONE_<X> (when that is unset)
if [[ -n "${KOTONE_LEGACY_PREFIX:-}" ]]; then
  for _n in $(compgen -e); do
    [[ "$_n" == "${KOTONE_LEGACY_PREFIX}_"* ]] || continue
    _k="KOTONE_${_n#"${KOTONE_LEGACY_PREFIX}"_}"; [[ -n "${!_k+x}" ]] || export "$_k=${!_n}"
  done; unset _n _k
fi
SLUG="${KOTONE_SLUG:-$(basename "$ROOT")}"
OPS_DIR="${KOTONE_OPS_DIR:-$(git rev-parse --path-format=absolute --git-common-dir)/${KOTONE_OPS_DIRNAME:-kotone-ops}}"
mkdir -p "$OPS_DIR/claims" "$OPS_DIR/queue" "$OPS_DIR/done" "$OPS_DIR/logs" "$OPS_DIR/notes"
# Worktrees: $KOTONE_WORKTREES, else /mnt/wsl/work/worktrees when that directory exists (fast WSL disk),
# else <repo>/../<slug>-worktrees. Each task gets <worktrees>/<slug>-<id>.
WORKTREES="${KOTONE_WORKTREES:-/mnt/wsl/work/worktrees}"
[[ -d "$WORKTREES" ]] || WORKTREES="$ROOT/../$SLUG-worktrees"
# The main checkout (first entry of `git worktree list`), a stable place to run commands from.
MAIN_WT="$(git worktree list --porcelain | sed -n '1s/^worktree //p')"

# locked <cmd> [args]: run a shell function/command while holding the ops lock (released on return).
locked() { ( flock 9; "$@" ) 9>"$OPS_DIR/.lock"; }

# atomic_write <file>: stdin -> tmp in the same dir (dot-prefixed, so globs skip it) -> mv. Refuses empty input.
atomic_write() {
  local f="$1" t; t="$(dirname "$f")/.tmp.$$.$RANDOM"
  cat > "$t" && [[ -s "$t" ]] && mv -f "$t" "$f" || { rm -f "$t"; echo "atomic_write: refused/failed for $f" >&2; return 1; }
}
f_set() { # <file> <key> <value>: replace the first "key: ..." line or append one
  K="$2" V="$3" awk 'BEGIN{k=ENVIRON["K"]; v=ENVIRON["V"]; d=0} index($0,k": ")==1 && !d {print k": "v; d=1; next} {print} END{if(!d) print k": "v}' "$1" | atomic_write "$1"
}
f_del() { K="$2" awk 'BEGIN{k=ENVIRON["K"]} index($0,k": ")!=1 {print}' "$1" | atomic_write "$1"; }
f_append() { { cat "$1"; printf '%s\n' "$2"; } | atomic_write "$1"; }
f_get() { sed -n "s/^$2: //p" "$1" | head -1; }

# ---- claim lifecycle -------------------------------------------------------------------------
# claimed -> started -> queued -> merging -> merged|failed -> released   (queued->started = dequeue,
# merging->queued = retry, failed->queued|started = fix and re-queue). Claims written before this
# existed have no state line: "legacy", allowed to go anywhere.
claim_file() { echo "$OPS_DIR/claims/$1"; }
get_state() { local s; s="$(f_get "$(claim_file "$1")" state)"; echo "${s:-legacy}"; }
valid_next() {
  case "$1>$2" in
    legacy'>'*|claimed'>'started|claimed'>'released|started'>'queued|started'>'released|queued'>'merging|queued'>'started|\
    merging'>'merged|merging'>'failed|merging'>'queued|merged'>'released|failed'>'queued|failed'>'started|failed'>'released) return 0 ;;
  esac
  return 1
}
# set_state <id> <new> [note]: THE only way a claim's state changes. Caller holds the lock.
set_state() {
  local id="$1" new="$2" note="${3:-}" f cur; f="$(claim_file "$id")"
  [[ -e "$f" ]] || { echo "no claim $id" >&2; return 1; }
  cur="$(get_state "$id")"
  valid_next "$cur" "$new" || { echo "task $id: illegal state transition $cur -> $new" >&2; return 1; }
  f_set "$f" state "$new" && f_append "$f" "state-log: $(date -Is) $cur -> $new $note"
}
overlap() { # $1 $2 -> 0 if one path is a prefix of the other
  local a="${1%/}" b="${2%/}"
  [[ "$a" == "$b" || "$a" == "$b"/* || "$b" == "$a"/* ]]
}
# inside <dir> <path>: 0 if path is dir or below it
inside() { [[ -n "$2" && -n "$1" && ( "$2" == "$1" || "$2" == "$1"/* ) ]]; }

# ---- worktree removal guard ----------------------------------------------------------------------
# Worktrees were once deleted by something other than the task owner. `task.sh release` is the ONLY code path that removes a task
# worktree, and it goes through remove_worktree: it refuses unless the claim for <id> exists, records exactly <wt> as its worktree,
# and its state allows release. Every removal and every refusal appends one line to $OPS_DIR/worktree-removals.log:
#   ISO time | task id | worktree | caller | $KOTONE_AGENT | parent chain (pid:comm, 4 levels) | result
wt_chain() { # parent process chain of this shell, up to 4 levels: pid:comm<pid:comm...
  local p=$$ out="" i n pp c
  for i in 1 2 3 4; do
    read -r pp c < <(ps -o ppid=,comm= -p "$p" 2>/dev/null) || break
    [[ -n "${c:-}" ]] || break
    out="${out:+$out<}$p:$c"; [[ "$pp" =~ ^[0-9]+$ && "$pp" -gt 0 ]] || break; p="$pp"
  done
  echo "${out:-?}"
}
wt_log() { # <id> <wt> <caller> <result>
  printf '%s | %s | %s | %s | %s | %s | %s\n' "$(date -Is)" "$1" "$2" "$3" "${KOTONE_AGENT:-unknown}" "$(wt_chain)" "$4" >>"$OPS_DIR/worktree-removals.log" \
    || echo "WARNING: cannot write $OPS_DIR/worktree-removals.log" >&2
}
# remove_worktree <id> <wt> <caller>: rc 0 removed, 1 refused or failed (the reason is printed and logged). Caller holds the ops lock.
remove_worktree() {
  local id="$1" wt="$2" caller="$3" f rec st why=""
  f="$(claim_file "$id")"
  if [[ -z "$id" || -z "$wt" ]]; then why="empty task id or worktree path"
  elif [[ ! -e "$f" ]]; then why="no claim file for task $id"
  else
    rec="$(f_get "$f" worktree)"; st="$(get_state "$id")"
    if [[ "$rec" != "$wt" ]]; then why="claim records worktree '${rec:-none}', not '$wt'"
    elif [[ "$wt" == "$MAIN_WT" || "$wt" == "$ROOT" ]]; then why="that is the main checkout"
    elif [[ "$st" != released ]] && ! valid_next "$st" released; then why="state $st does not allow release"; fi
  fi
  if [[ -n "$why" ]]; then
    echo "REFUSED to remove worktree $wt: $why"; wt_log "$id" "$wt" "$caller" "REFUSED: $why"; return 1
  fi
  # task.sh start locks the worktree (so `git worktree prune|remove` by anyone else cannot take it); unlock first. Already unlocked is fine.
  git worktree unlock "$wt" 2>/dev/null || true
  if [[ ! -e "$wt" ]]; then
    # The folder is gone: drop only THIS worktree's admin entry (never a bare `git worktree prune`, which would touch other entries).
    if wt_drop_entry "$wt"; then wt_log "$id" "$wt" "$caller" "removed (folder was already gone; own entry dropped)"; return 0; fi
    wt_log "$id" "$wt" "$caller" "FAILED: folder gone and no admin entry found"; return 1
  fi
  if git worktree remove --force "$wt"; then wt_log "$id" "$wt" "$caller" "removed"; return 0; fi
  wt_log "$id" "$wt" "$caller" "FAILED: git worktree remove failed"; return 1
}
# wt_lock <wt> <id>: lock a task worktree against prune/remove by other agents. Tolerant: already locked or any failure is not an error.
wt_lock() { git worktree lock --reason "task $2" "$1" 2>/dev/null || true; }
# wt_drop_entry <wt>: remove the admin entry (<common git dir>/worktrees/<name>) whose gitdir file points at <wt>/.git. rc 0 also when none exists.
wt_drop_entry() {
  local cd d g; cd="$(git rev-parse --path-format=absolute --git-common-dir)" || return 1
  for d in "$cd"/worktrees/*; do
    [[ -f "$d/gitdir" ]] || continue
    g="$(cat "$d/gitdir")"; [[ "$g" == "$1/.git" ]] && { rm -rf "$d"; return 0; }
  done
  return 0
}

# ---- node_modules preparation ------------------------------------------------------------------
# A new worktree needs node_modules identical to `npm ci` for ITS lockfile. A cold `npm ci` takes
# 15-30 s; a plain copy of a previously installed tree from the same filesystem takes ~2 s.
# The cache lives next to the worktrees (same filesystem, hidden so nothing globs it), keyed by
# sha256(package.json + package-lock.json + node version + arch), and keeps the last 3 keys.
# A key only exists once a full `npm ci` finished (built in a temp dir, then mv'd), so a hit is
# always complete. We copy (cp -a, reflink where possible), never hardlink: tools that write into
# node_modules in place would otherwise corrupt the cache and every other worktree.
NODE_CACHE="${KOTONE_NODE_CACHE:-$WORKTREES/.node-cache}"
NODE_CACHE_KEEP=3

node_cache_key() { # <worktree> -> key on stdout
  { cat "$1/package.json" "$1/package-lock.json"; node -v; uname -m; } | sha256sum | cut -d' ' -f1
}
# node_cache_prune: keep the newest $NODE_CACHE_KEEP keys (by mtime; hits touch their key). Caller holds the cache lock.
node_cache_prune() {
  local d n=0
  while read -r d; do
    n=$((n+1)); [[ $n -le $NODE_CACHE_KEEP ]] && continue
    rm -rf "$NODE_CACHE/$d" || echo "WARNING: could not prune $NODE_CACHE/$d" >&2
  done < <(cd "$NODE_CACHE" && find . -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '\./[0-9a-f]{64}' -printf '%T@ %f\n' | sort -rn | cut -d' ' -f2)
  rm -rf "$NODE_CACHE"/.tmp.* 2>/dev/null; return 0
}
# node_cache_restore <wt> <key>: copy a cached tree into the worktree. rc 0 = ready, 1 = miss/failed (node_modules removed).
node_cache_restore() {
  local wt="$1" key="$2" src="$NODE_CACHE/$2/node_modules"
  [[ -d "$src/.bin" && -f "$src/.package-lock.json" ]] || return 1
  if cp -a --reflink=auto "$src" "$wt/node_modules" && [[ -d "$wt/node_modules/.bin" ]] \
     && touch "$wt/node_modules/.package-lock.json" "$NODE_CACHE/$key"; then
    return 0   # the touch keeps check.sh's "lockfile newer than node_modules" test from reinstalling
  fi
  rm -rf "$wt/node_modules"; return 1
}
# node_cache_store <wt> <key>: save the worktree's fresh node_modules under key (atomic mv), then prune.
node_cache_store() {
  local wt="$1" key="$2" t="$NODE_CACHE/.tmp.$$.$RANDOM"
  rm -rf "${NODE_CACHE:?}/${key:?}"   # only reached after a failed restore: a leftover entry is incomplete/corrupt, replace it
  mkdir "$t" && cp -a --reflink=auto "$wt/node_modules" "$t/node_modules" && mv "$t" "$NODE_CACHE/$key" \
    || { rm -rf "$t"; echo "WARNING: could not store node_modules cache" >&2; return 1; }
  node_cache_prune
}
# prepare_node_modules <wt>: cache hit -> copy; otherwise (or on any failure) plain `npm ci`, then fill the cache.
# rc 0 = node_modules ready; non-zero = even npm ci failed (the caller reports it).
prepare_node_modules() {
  local wt="$1" key how t0 t1; t0=$SECONDS
  [[ -d "$wt/node_modules" ]] && { echo "node_modules: already present"; return 0; }
  [[ -f "$wt/package-lock.json" && -f "$wt/package.json" ]] || { echo "node_modules: no package-lock.json, skipping"; return 0; }
  mkdir -p "$NODE_CACHE" || return 1
  key="$(node_cache_key "$wt")" || return 1
  if ( flock 8; node_cache_restore "$wt" "$key" ) 8>"$NODE_CACHE/.lock"; then how="restored from cache ${key:0:12}"
  else
    echo "node_modules: cache miss (${key:0:12}), running npm ci"
    ( cd "$wt" && npm ci --prefer-offline --no-audit --no-fund ) || { rm -rf "$wt/node_modules"; return 1; }
    how="npm ci (cache ${key:0:12} filled)"
    ( flock 8; node_cache_store "$wt" "$key" ) 8>"$NODE_CACHE/.lock" || how="npm ci (cache not filled)"
  fi
  t1=$SECONDS; echo "node_modules: $how in $((t1-t0))s"
}
