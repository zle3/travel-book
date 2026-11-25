// Task lifecycle + merge queue tests. Each test builds a throwaway git repo (bare origin + clone) holding a COPY of
// scripts/ops, with stub check.sh/deploy.sh and a fake gh, and isolated KOTONE_OPS_DIR / KOTONE_WORKTREES.
// Set KOTONE_OPS_SRC=<dir with lib.sh task.sh mq.sh> to run the same tests against another version of the scripts
// (used to prove the auto-release test fails on main's old scripts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, cpSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SLUG = 'testproj';
// Snapshot of leak-prone names in the REAL default worktrees dir; the last test of this file asserts nothing new appeared there.
const REAL_WT_BEFORE = existsSync('/mnt/wsl/work/worktrees') ? readdirSync('/mnt/wsl/work/worktrees') : [];
const SRC = process.env.KOTONE_OPS_SRC || resolve(dirname(fileURLToPath(import.meta.url)), '../ops');
// Git hooks export GIT_DIR / GIT_INDEX_FILE / ... Every GIT_* variable is scrubbed before any child process starts,
// so the throwaway repos built here can never be redirected into the real repository.
const cleanEnv = (extra = {}) => {
  // The test's own commits (and those made by the scripts under test) need an identity even in a clean HOME.
  const env = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', ...process.env, ...extra };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_') && !/^GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)$/.test(k)) delete env[k];
  return env;
};
const sh = (cwd, cmd, env = {}) => spawnSync('bash', ['-c', cmd], { cwd, env: cleanEnv(env), encoding: 'utf8' });
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: cleanEnv({ GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }) });

const GH = `#!/usr/bin/env bash
# fake gh. KOTONE_FAKE_STATE (default OPEN) is the PR state; KOTONE_FAKE_HEAD its head branch; mergeability always ready.
# Honours the jq -q filter only as far as the script uses it: a select(.state=="OPEN") query prints nothing for a non-open PR.
# Optional: KOTONE_FAKE_HEADS="21=task/a,22=task/b" gives each PR its own head (real oid = origin/<branch>);
#   KOTONE_FAKE_ORIGIN=<bare repo> makes "pr merge" really merge the --match-head-commit oid into main there;
#   KOTONE_FAKE_AFTER_MERGE=<executable> runs after each simulated merge (it disarms itself);
#   KOTONE_FAKE_COMMENTS=<file, one JSON string per line> + KOTONE_FAKE_REVIEW_HEAD=<sha> serve the review gate;
#   KOTONE_FAKE_GHFAIL=1 makes the comment lookup fail;
#   KOTONE_FAKE_MERGE_FAIL=N makes the first N merge calls fail with "Base branch was modified" (running KOTONE_FAKE_ON_FAIL first);
#   KOTONE_FAKE_ON_WAIT=<executable> runs on every mergeability poll (movesMain disarms itself).
st="\${KOTONE_FAKE_STATE:-OPEN}"
br=""
for m in \${KOTONE_FAKE_HEADS//,/ }; do [[ "\${m%%=*}" == "$3" ]] && br="\${m#*=}"; done
if [[ "$1 $2" == "pr view" ]]; then
  if [[ "$*" == *'--json comments'* ]]; then
    [[ -n "\${KOTONE_FAKE_GHFAIL:-}" ]] && { echo "gh: network down" >&2; exit 1; }
    [[ -n "\${KOTONE_FAKE_COMMENTS:-}" && -f "$KOTONE_FAKE_COMMENTS" ]] && cat "$KOTONE_FAKE_COMMENTS"; exit 0
  fi
  if [[ "$*" == *'--json headRefOid -q'* ]]; then echo "\${KOTONE_FAKE_REVIEW_HEAD:-}"; exit 0; fi
  if [[ "$*" == *headRefName* && "$*" != *mergeable* ]]; then
    [[ "$*" == *'select('* && "$st" != OPEN ]] && exit 0
    if [[ "$*" == *'@tsv'* ]]; then
      if [[ -n "$br" ]]; then printf '%s\\t%s\\t%s\\n' "$st" "$br" "$(git rev-parse "origin/$br")"
      else printf '%s\\t%s\\t%s\\n' "$st" "\${KOTONE_FAKE_HEAD:-}" "\${KOTONE_FAKE_OID:-}"; fi
    else echo "\${KOTONE_FAKE_HEAD:-}"; fi
    exit 0
  fi
  if [[ "$*" == *"--json state"* ]]; then echo "$st"; exit 0; fi
  [[ "$*" == *mergeable* && -n "\${KOTONE_FAKE_ON_WAIT:-}" && -x "$KOTONE_FAKE_ON_WAIT" ]] && "$KOTONE_FAKE_ON_WAIT"
  if [[ -n "$br" ]]; then printf '%s\\tMERGEABLE\\tCLEAN\\n' "$(git rev-parse "origin/$br")"; exit 0; fi
  printf '%s\\tMERGEABLE\\tCLEAN\\n' "$(git rev-parse HEAD)"; exit 0
fi
[[ "$1 $2" == "pr close" ]] && { echo "STUB closed $*" >> "\${KOTONE_FAKE_LOG:-/dev/null}"; exit 0; }
if [[ "$1 $2" == "pr merge" ]]; then
  if [[ -n "\${KOTONE_FAKE_MERGE_FAIL:-}" ]]; then
    cf="\${KOTONE_FAKE_LOG:-/dev/null}.mergefails"; n=$(cat "$cf" 2>/dev/null || echo 0)
    if [[ $n -lt $KOTONE_FAKE_MERGE_FAIL ]]; then
      echo $((n+1)) > "$cf"; [[ -n "\${KOTONE_FAKE_ON_FAIL:-}" && -x "$KOTONE_FAKE_ON_FAIL" ]] && "$KOTONE_FAKE_ON_FAIL"
      echo "GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)"; exit 1
    fi
  fi
  echo "STUB merged $*"; echo "STUB merged $*" >> "\${KOTONE_FAKE_LOG:-/dev/null}"
  if [[ -n "\${KOTONE_FAKE_ORIGIN:-}" ]]; then
    oid=""; prev=""; for a in "$@"; do [[ "$prev" == --match-head-commit ]] && oid="$a"; prev="$a"; done
    t="$(mktemp -d)"
    ( git clone -q "$KOTONE_FAKE_ORIGIN" "$t/c" && cd "$t/c" && git checkout -q main && git merge -q --no-ff -m "Merge PR $3" "$oid" && git push -q origin main ) >/dev/null 2>&1 \
      || { echo "STUB merge failed for $oid"; exit 1; }
    rm -rf "$t"
    [[ -n "\${KOTONE_FAKE_AFTER_MERGE:-}" && -x "$KOTONE_FAKE_AFTER_MERGE" ]] && "$KOTONE_FAKE_AFTER_MERGE"
  fi
  exit 0
fi
exit 0
`;

function setup() {
  const T = mkdtempSync(join(tmpdir(), 'kotone-ops-'));
  git(T, 'init', '-q', '--bare', 'origin.git');
  git(T, 'clone', '-q', 'origin.git', 'repo');
  const repo = join(T, 'repo');
  mkdirSync(join(repo, 'scripts/ops'), { recursive: true });
  for (const f of ['lib.sh', 'task.sh', 'mq.sh']) cpSync(join(SRC, f), join(repo, 'scripts/ops', f));
  for (const f of ['check.sh', 'deploy.sh']) writeFileSync(join(repo, 'scripts', f), '#!/usr/bin/env bash\nexit 0\n');
  mkdirSync(join(repo, 'ops'), { recursive: true });
  writeFileSync(join(repo, 'ops/project.conf'), `KOTONE_SLUG="${SLUG}"\n`);
  sh(repo, 'chmod +x scripts/*.sh scripts/ops/*.sh');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'init'); git(repo, 'branch', '-M', 'main'); git(repo, 'push', '-q', 'origin', 'main');
  writeFileSync(join(T, 'gh'), GH); chmodSync(join(T, 'gh'), 0o755);
  const env = { KOTONE_OPS_DIR: join(T, 'ops'), KOTONE_WORKTREES: join(T, 'wt'), KOTONE_MQ_GH: join(T, 'gh'), KOTONE_MQ_REQUIRE_REVIEW: '0', KOTONE_MQ_DRYRUN: 'gh', KOTONE_MQ_POLL: '1', KOTONE_MQ_WAIT: '5', KOTONE_MQ_BACKOFF: '1' };
  mkdirSync(env.KOTONE_WORKTREES);
  const ctx = {
    T, repo, env,
    task: (...a) => sh(repo, `scripts/ops/task.sh ${a.map((x) => JSON.stringify(x)).join(' ')}`, env),
    mq: (...a) => sh(repo, `scripts/ops/mq.sh ${a.map((x) => JSON.stringify(x)).join(' ')}`, env),
    claimFile: (id) => join(env.KOTONE_OPS_DIR, 'claims', id),
    state: (id) => (readFileSync(join(env.KOTONE_OPS_DIR, 'claims', id), 'utf8').match(/^state: (.*)$/m) || [])[1],
    // claim + start + push a feature branch (head) so the fake PR has something to check out
    ready(id, paths = [`src/${id}`]) {
      assert.equal(ctx.task('claim', id, 'agent-x', 'title', ...paths).status, 0);
      const st = ctx.task('start', id); assert.equal(st.status, 0, st.stdout + st.stderr);
      const wt = join(env.KOTONE_WORKTREES, `${SLUG}-${id}`);
      writeFileSync(join(wt, `${id}.txt`), id); git(wt, 'add', '.'); git(wt, 'commit', '-qm', id); git(wt, 'push', '-q', 'origin', `task/${id}`);
      return wt;
    },
    run: (cwd = repo, extra = {}) => sh(cwd, `${join(repo, 'scripts/ops/mq.sh')} run`, { ...env, KOTONE_MQ_HEAD: extra.head || '', ...extra }),
  };
  return ctx;
}
const order = (c) => c.mq('list').stdout.split('-- held')[0].split('\n').filter((l) => /^#\d/.test(l)).map((l) => l.match(/PR (\d+)/)[1]);

test('state transitions: claimed -> started -> queued; release refused while queued', () => {
  const c = setup(); c.ready('t1');
  assert.equal(c.state('t1'), 'started');
  assert.equal(c.mq('add', '5', 't1', 'a', 'no').status, 0);
  assert.equal(c.state('t1'), 'queued');
  const r = c.task('release', 't1');
  assert.notEqual(r.status, 0); assert.match(r.stdout, /queued/);
  const rf = c.task('release', 't1', '--force');
  assert.notEqual(rf.status, 0, 'even --force does not release a queued claim');
  assert.ok(existsSync(c.claimFile('t1')));
  assert.match(c.task('list').stdout, /t1 \| queued \|/);
});

test('mq add requires an existing, started claim', () => {
  const c = setup();
  assert.notEqual(c.mq('add', '5', 'nope', 'a', 'no').status, 0);
  c.task('claim', 't2', 'a', 't', 'src/t2'); // claimed, not started
  const r = c.mq('add', '6', 't2', 'a', 'no');
  assert.notEqual(r.status, 0); assert.match(r.stdout, /must be started/);
});

test('release refuses a dirty worktree unless --force; clean release removes it', () => {
  const c = setup(); const wt = c.ready('t3');
  writeFileSync(join(wt, 'junk.txt'), 'x');
  const r = c.task('release', 't3'); assert.notEqual(r.status, 0); assert.match(r.stdout, /uncommitted/);
  assert.ok(existsSync(wt));
  assert.equal(c.task('release', 't3', '--force').status, 0);
  assert.ok(!existsSync(wt));
  assert.equal(c.task('list').stdout.trim(), 'no open tasks');
});

test('re-claiming a released id: reuse merged branch, refuse unmerged', () => {
  const c = setup(); const wt = c.ready('t4');
  // branch has an unmerged commit: refuse
  assert.equal(c.task('release', 't4').status, 0);
  const bad = c.task('claim', 't4', 'a', 't', 'src/t4');
  assert.notEqual(bad.status, 0); assert.match(bad.stdout, /unmerged|not in/i);
  // merge it into main, then re-claim works and start gives a fresh worktree
  git(c.repo, 'merge', '-q', '--no-edit', 'task/t4'); git(c.repo, 'push', '-q', 'origin', 'main');
  assert.equal(c.task('claim', 't4', 'a', 't', 'src/t4').status, 0);
  const s = c.task('start', 't4'); assert.equal(s.status, 0, s.stdout + s.stderr);
  assert.equal(c.state('t4'), 'started');
  assert.ok(existsSync(wt));
});

test('merged entry auto-releases its claim and worktree', () => {
  const c = setup(); const wt = c.ready('t5');
  c.mq('add', '5', 't5', 'a', 'no');
  const r = c.run(c.repo, { head: 'task/t5' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /PR 5: merged/);
  assert.ok(!existsSync(c.claimFile('t5')), 'claim must be released');
  assert.ok(existsSync(join(c.env.KOTONE_OPS_DIR, 'done', 't5')));
  assert.ok(!existsSync(wt));
});

test('REGRESSION: runner started inside a task worktree that gets released still releases every later claim', () => {
  // main's old scripts removed the worktree the runner stood in; every later release then failed silently.
  const c = setup(); const wt1 = c.ready('ta'); c.ready('tb');
  c.mq('add', '1', 'ta', 'a', 'no'); c.mq('add', '2', 'tb', 'a', 'no');
  // run the repo's own script path from inside ta's worktree (the real incident ran its mq.sh copy from a task worktree)
  const r = sh(wt1, `${join(wt1, 'scripts/ops/mq.sh')} run`, { ...c.env, KOTONE_MQ_HEAD: 'task/ta' });
  assert.match(r.stdout, /PR 1: merged/); assert.match(r.stdout, /PR 2: merged/);
  assert.ok(!existsSync(c.claimFile('tb')), 'second claim must be released too\n' + r.stdout + r.stderr);
  assert.ok(!existsSync(c.claimFile('ta')), 'first claim must be released\n' + r.stdout + r.stderr);
  assert.equal(c.task('list').stdout.trim(), 'no open tasks');
});

test('runner never removes the worktree it runs from, and says so', () => {
  const c = setup(); const wt = c.ready('tc');
  c.mq('add', '3', 'tc', 'a', 'no');
  const r = sh(wt, `${join(wt, 'scripts/ops/mq.sh')} run`, { ...c.env, KOTONE_MQ_HEAD: 'task/tc' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(wt), 'worktree kept'); assert.match(r.stdout, /WARNING: kept worktree/);
  assert.ok(!existsSync(c.claimFile('tc')));
});

test('release failure is loud: run exits 1 and reports RELEASE FAILED', () => {
  const c = setup(); c.ready('td'); c.mq('add', '4', 'td', 'a', 'no');
  // sabotage: make the claim vanish mid-run by replacing task.sh with a failing stub
  writeFileSync(join(c.repo, 'scripts/ops/task.sh'), '#!/usr/bin/env bash\necho boom; exit 9\n');
  const r = c.run(c.repo, { head: 'task/td' });
  assert.equal(r.status, 1); assert.match(r.stdout, /RELEASE FAILED for task td/);
  assert.ok(existsSync(c.claimFile('td')), 'claim left in place for the lead');
});

test('crash mid-merge: merging entry is visible, finalized if PR merged, retried otherwise', () => {
  for (const [ghState, expectMerged] of [['MERGED', true], ['OPEN', true]]) {
    const c = setup(); c.ready('te'); c.mq('add', '7', 'te', 'a', 'no');
    // simulate a crashed runner: claim + entry say merging
    sh(c.repo, `. scripts/ops/lib.sh && locked set_state te merging crash`, c.env);
    assert.equal(c.state('te'), 'merging');
    assert.match(c.mq('list').stdout, /\| merging/);
    assert.notEqual(c.task('release', 'te').status, 0, 'refused while merging');
    const r = c.run(c.repo, { head: 'task/te', KOTONE_FAKE_STATE: ghState });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /recovering PR 7/);
    assert.ok(!existsSync(c.claimFile('te')) === expectMerged);
    assert.match(readdirSync(join(c.env.KOTONE_OPS_DIR, 'done')).join(' '), /pr7-/);
  }
});

test('hold / unhold / move use an explicit order, not filenames', () => {
  const c = setup();
  for (const [i, id] of [1, 2, 3, 4].entries()) { c.ready(`t${id}x`); c.mq('add', String(10 + id), `t${id}x`, 'a', 'no'); }
  assert.deepEqual(order(c), ['11', '12', '13', '14']);
  assert.equal(c.mq('hold', '12').status, 0);
  const l = c.mq('list').stdout;
  assert.match(l, /-- held[\s\S]*PR 12/); assert.ok(l.indexOf('-- held') > l.indexOf('PR 13'));
  // a new entry added while 12 is held must NOT jump the line
  c.ready('t5x'); c.mq('add', '15', 't5x', 'a', 'no');
  assert.equal(c.mq('unhold', '12').status, 0);
  assert.deepEqual(order(c), ['11', '12', '13', '14', '15'], 'unhold restores original position');
  assert.equal(c.mq('move', '14', '1').status, 0);
  assert.deepEqual(order(c), ['14', '11', '12', '13', '15']);
  assert.equal(c.mq('move', '14', '5').status, 0);
  assert.deepEqual(order(c), ['11', '12', '13', '15', '14']);
  assert.notEqual(c.mq('move', '14', '9').status, 0);
  // run honours order and skips held
  c.mq('hold', '11');
  const r = c.run(c.repo, { head: 'task/t2x' });
  const seq = [...r.stdout.matchAll(/^== PR (\d+)/gm)].map((m) => m[1]);
  assert.deepEqual(seq, ['12', '13', '15', '14']);
  assert.match(r.stdout, /nothing runnable/);
  assert.deepEqual(order(c), []); assert.match(c.mq('list').stdout, /held[\s\S]*PR 11/);
});

test('grant adds paths with an overlap check and records who/when', () => {
  const c = setup();
  c.task('claim', 'g1', 'a', 't', 'src/a'); c.task('claim', 'g2', 'b', 't', 'src/b');
  const ok = c.task('grant', 'g1', 'docs/x.md'); assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const body = readFileSync(c.claimFile('g1'), 'utf8');
  assert.match(body, /^path: docs\/x\.md$/m); assert.match(body, /^grant: \S+ by \S+: docs\/x\.md$/m);
  const bad = c.task('grant', 'g1', 'src/b/deep/file.ts');
  assert.notEqual(bad.status, 0); assert.match(bad.stdout, /CONFLICT.*g2/);
  assert.doesNotMatch(readFileSync(c.claimFile('g1'), 'utf8'), /src\/b\/deep/);
  assert.match(c.task('who', 'docs/x.md/y').stdout, /g1/);
  assert.notEqual(c.task('grant', 'nope', 'z').status, 0);
});

test('atomic writes: a concurrent reader never sees a partial claim file', () => {
  const c = setup();
  c.task('claim', 'at', 'a', 't', 'src/at');
  const script = `for i in $(seq 1 40); do scripts/ops/task.sh grant at p$i/f >/dev/null; done`;
  const child = execFileSync('bash', ['-c', `(${script}) & echo $!`], { cwd: c.repo, env: cleanEnv(c.env), encoding: 'utf8' }).trim();
  let reads = 0, bad = [];
  const alive = () => { try { process.kill(Number(child), 0); return true; } catch { return false; } };
  while (alive() || reads < 50) {
    for (const f of readdirSync(join(c.env.KOTONE_OPS_DIR, 'claims'))) {
      let t; try { t = readFileSync(join(c.env.KOTONE_OPS_DIR, 'claims', f), 'utf8'); } catch { continue; }
      reads++;
      if (f.startsWith('.tmp') || !t.startsWith('id: at\n') || !t.endsWith('\n') || !/^state: /m.test(t) || !/^path: src\/at$/m.test(t)) bad.push([f, t.slice(-40)]);
    }
  }
  assert.deepEqual(bad, []);
  // all 40 grants landed (each under the lock, none lost)
  assert.equal((readFileSync(c.claimFile('at'), 'utf8').match(/^path: p\d+\/f$/gm) || []).length, 40);
  assert.deepEqual(readdirSync(join(c.env.KOTONE_OPS_DIR, 'claims')).filter((f) => f.startsWith('.')), []);
});

// ---- stacked / contained PRs -------------------------------------------------------------------------------------
// The PR adds nothing to main: the queue must not check or merge it, must mark the task merged ("already contained in
// main"), release the claim, and close the PR with a comment when GitHub still shows it OPEN.
function contained(c, id, pr, extra) {
  c.mq('add', String(pr), id, 'a', 'no');
  const log = join(c.T, 'gh.log');
  const r = c.run(c.repo, { KOTONE_FAKE_HEAD: `task/${id}`, KOTONE_FAKE_LOG: log, ...extra });
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 0, out);
  assert.match(out, new RegExp(`PR ${pr}: merged`));
  assert.ok(!existsSync(c.claimFile(id)), 'claim released\n' + out);
  const done = readdirSync(join(c.env.KOTONE_OPS_DIR, 'done')).filter((f) => f.startsWith(`pr${pr}-`));
  assert.equal(done.length, 1);
  const body = readFileSync(join(c.env.KOTONE_OPS_DIR, 'done', done[0]), 'utf8');
  assert.match(body, /already contained in main/, 'entry notes why it was skipped\n' + body);
  assert.match(readFileSync(join(c.env.KOTONE_OPS_DIR, 'done', id), 'utf8'), /already contained in main/);
  const gh = existsSync(log) ? readFileSync(log, 'utf8') : '';
  assert.doesNotMatch(gh, /STUB merged/, 'must not call gh pr merge');
  return gh;
}

test('contained PR: GitHub state MERGED (branch gone) is skipped, not failed', () => {
  const c = setup(); c.ready('m1');
  git(c.repo, 'merge', '-q', '--no-edit', 'task/m1'); git(c.repo, 'push', '-q', 'origin', 'main');
  git(c.repo, 'push', '-q', 'origin', '--delete', 'task/m1');
  const gh = contained(c, 'm1', 21, { KOTONE_FAKE_STATE: 'MERGED' });
  assert.doesNotMatch(gh, /STUB closed/, 'already merged: nothing to close');
});

test('contained PR: head is an ancestor of origin/main (still OPEN) is skipped and closed with a comment', () => {
  const c = setup(); c.ready('m2');
  git(c.repo, 'merge', '-q', '--ff-only', 'task/m2'); git(c.repo, 'push', '-q', 'origin', 'main');
  const gh = contained(c, 'm2', 22, {});
  assert.match(gh, /STUB closed pr close 22 --comment .*contained in main/);
});

test('contained PR: every commit patch-equivalent on main (cherry-pick) is skipped and closed', () => {
  const c = setup(); c.ready('m3');
  writeFileSync(join(c.repo, 'other.txt'), 'o'); git(c.repo, 'add', '.'); git(c.repo, 'commit', '-qm', 'other');
  git(c.repo, 'cherry-pick', 'origin/task/m3'); git(c.repo, 'push', '-q', 'origin', 'main');
  assert.notEqual(git(c.repo, 'rev-parse', 'HEAD').trim(), git(c.repo, 'rev-parse', 'origin/task/m3').trim());
  const gh = contained(c, 'm3', 23, {});
  assert.match(gh, /STUB closed pr close 23/);
});

test('a PR with real changes is still checked and merged', () => {
  const c = setup(); c.ready('m4'); c.mq('add', '24', 'm4', 'a', 'no');
  const log = join(c.T, 'gh.log');
  const r = c.run(c.repo, { KOTONE_FAKE_HEAD: 'task/m4', KOTONE_FAKE_LOG: log });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(readFileSync(log, 'utf8'), /STUB merged/);
  assert.doesNotMatch(r.stdout, /already contained/);
});

test('project.conf KOTONE_OPS_DIRNAME + KOTONE_LEGACY_PREFIX: own state dir name and legacy env names', () => {
  const c = setup();
  writeFileSync(join(c.repo, 'ops/project.conf'), `KOTONE_SLUG="${SLUG}"\nKOTONE_OPS_DIRNAME="old-ops"\nKOTONE_LEGACY_PREFIX=OLD\n`);
  const env = { PATH: process.env.PATH, OLD_WORKTREES: c.env.KOTONE_WORKTREES };
  const r = sh(c.repo, 'unset KOTONE_WORKTREES KOTONE_OPS_DIR; scripts/ops/task.sh claim z1 a t src/z1 && scripts/ops/task.sh start z1 --no-install', env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(c.repo, '.git/old-ops/claims/z1')), 'state lives in .git/old-ops');
  assert.ok(!existsSync(join(c.repo, '.git/kotone-ops')));
  assert.ok(existsSync(join(c.env.KOTONE_WORKTREES, `${SLUG}-z1`)), 'OLD_WORKTREES honoured');
});

// ---- optional project hooks: ops/hooks/start and ops/hooks/release ----
// Hook scripts append "<name> args=<id> <wt> env=<KOTONE_TASK_ID> <KOTONE_WORKTREE> <KOTONE_OPS_DIR> cwd=<pwd> wt_exists=<yes|no>" to a log.
function addHook(c, name, body) {
  mkdirSync(join(c.repo, 'ops/hooks'), { recursive: true });
  const p = join(c.repo, 'ops/hooks', name);
  writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`); chmodSync(p, 0o755);
  return p;
}
const LOGGER = (log, name) => `echo "${name} args=$1 $2 env=$KOTONE_TASK_ID $KOTONE_WORKTREE $KOTONE_OPS_DIR cwd=$(pwd -P) wt_exists=$([ -d "$2" ] && echo yes || echo no)" >> ${JSON.stringify(log)}`;

test('hooks: start hook runs once with id/worktree args, env and cwd = worktree', () => {
  const c = setup(); const log = join(c.T, 'hook.log');
  addHook(c, 'start', LOGGER(log, 'start'));
  assert.equal(c.task('claim', 'h1', 'a', 't', 'src/h1').status, 0);
  const st = c.task('start', 'h1', '--no-install'); assert.equal(st.status, 0, st.stdout + st.stderr);
  const wt = join(c.env.KOTONE_WORKTREES, `${SLUG}-h1`);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(lines[0], `start args=h1 ${wt} env=h1 ${wt} ${c.env.KOTONE_OPS_DIR} cwd=${wt} wt_exists=yes`);
  c.task('start', 'h1', '--no-install'); // already started: hook must not run again
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 1);
});

test('hooks: release hook runs before the worktree is removed (also via mq auto-release)', () => {
  const c = setup(); const log = join(c.T, 'hook.log');
  addHook(c, 'release', LOGGER(log, 'release'));
  const wt = c.ready('h2');
  const r = c.task('release', 'h2'); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(log, 'utf8').trim(), `release args=h2 ${wt} env=h2 ${wt} ${c.env.KOTONE_OPS_DIR} cwd=${wt} wt_exists=yes`);
  assert.ok(!existsSync(wt));
  // mq path: release runs via task.sh release --merged
  const wt3 = c.ready('h3');
  assert.equal(c.mq('add', '7', 'h3', 'a', 'no').status, 0);
  c.run(c.repo, { KOTONE_FAKE_HEAD: 'task/h3' });
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.ok(lines.some((l) => l.startsWith(`release args=h3 ${wt3} `) && l.endsWith('wt_exists=yes')), lines.join('\n'));
});

test('hooks: absent hooks are a silent no-op', () => {
  const c = setup();
  assert.equal(c.task('claim', 'h4', 'a', 't', 'src/h4').status, 0);
  const st = c.task('start', 'h4', '--no-install');
  assert.equal(st.status, 0);
  assert.equal(st.stdout.trim(), `worktree: ${join(c.env.KOTONE_WORKTREES, `${SLUG}-h4`)}`);
  assert.doesNotMatch(st.stdout + st.stderr, /hook/i);
  const r = c.task('release', 'h4');
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout + r.stderr, /hook/i);
  // a non-executable file is not a hook
  const c2 = setup(); const p = addHook(c2, 'start', 'echo ran > ' + JSON.stringify(join(c2.T, 'ran'))); chmodSync(p, 0o644);
  c2.task('claim', 'h5', 'a', 't', 'src/h5'); c2.task('start', 'h5', '--no-install');
  assert.ok(!existsSync(join(c2.T, 'ran')));
});

test('hooks: failing start hook warns but the claim stays started with rc 0', () => {
  const c = setup(); addHook(c, 'start', 'echo boom; exit 3');
  assert.equal(c.task('claim', 'h6', 'a', 't', 'src/h6').status, 0);
  const st = c.task('start', 'h6', '--no-install');
  assert.equal(st.status, 0, st.stdout + st.stderr);
  assert.match(st.stdout, /WARNING: ops\/hooks\/start failed for task h6 \(rc=3\)/);
  assert.equal(c.state('h6'), 'started');
});

test('hooks: failing release hook never blocks release', () => {
  const c = setup(); const wt = c.ready('h7'); addHook(c, 'release', 'exit 9');
  const r = c.task('release', 'h7');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /WARNING: ops\/hooks\/release failed for task h7 \(rc=9\)/);
  assert.ok(!existsSync(wt)); assert.equal(c.task('list').stdout.trim(), 'no open tasks');
});

// ---- K2: mq-add hook, mq-pre-merge hook, batching + tree-equality guard, review gate ------------------------------
// "real" mode: KOTONE_MQ_DRYRUN='' so mq.sh really pushes, and the fake gh really merges into the bare origin (KOTONE_FAKE_ORIGIN).
// check.sh stub: appends "check" to $KOTONE_TEST_LOG for every non-fast run and fails when the tree holds bad.txt.
// deploy.sh stub: appends "deploy". Both are committed to main before any task branch exists.
function real(c) {
  const log = join(c.T, 'events.log');
  writeFileSync(join(c.repo, 'scripts/check.sh'), '#!/usr/bin/env bash\n[[ "$1" == --fast ]] || echo check >> "$KOTONE_TEST_LOG"\n[[ -e bad.txt ]] && exit 1\nexit 0\n');
  writeFileSync(join(c.repo, 'scripts/deploy.sh'), '#!/usr/bin/env bash\necho deploy >> "$KOTONE_TEST_LOG"\nexit 0\n');
  git(c.repo, 'add', '.'); git(c.repo, 'commit', '-qm', 'stubs'); git(c.repo, 'push', '-q', 'origin', 'main');
  c.log = log; c.origin = join(c.T, 'origin.git'); c.ghlog = join(c.T, 'gh.log');
  c.events = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : []);
  c.merges = () => (existsSync(c.ghlog) ? readFileSync(c.ghlog, 'utf8').trim().split('\n').filter((l) => /STUB merged/.test(l)) : []);
  // prs: [[id, pr, deploy]]; creates the tasks (task branches pushed) and queues them
  c.queue = (prs) => {
    const heads = [];
    for (const [id, pr, dep] of prs) { c.ready(id); assert.equal(c.mq('add', String(pr), id, 'a', dep || 'no').status, 0); heads.push(`${pr}=task/${id}`); }
    c.heads = heads.join(',');
  };
  c.go = (batch, extra = {}) => c.run(c.repo, { KOTONE_MQ_DRYRUN: '', KOTONE_MQ_BATCH: String(batch), KOTONE_FAKE_ORIGIN: c.origin, KOTONE_FAKE_HEADS: c.heads,
    KOTONE_FAKE_LOG: c.ghlog, KOTONE_TEST_LOG: log, ...extra });
  c.mainFiles = () => { git(c.repo, 'fetch', '-q', 'origin'); return git(c.repo, 'ls-tree', '-r', '--name-only', 'origin/main').trim().split('\n'); };
  c.mainLog = () => git(c.repo, 'log', '--first-parent', '--format=%s', 'origin/main').trim().split('\n');
  return c;
}
// An executable that pushes one commit (moved.txt) to the bare origin's main, once.
function movesMain(c, name = 'move-main.sh') {
  const p = join(c.T, name), mark = join(c.T, name + '.done');
  writeFileSync(p, `#!/usr/bin/env bash\n[ -e ${JSON.stringify(mark)} ] && exit 0\ntouch ${JSON.stringify(mark)}\nt=$(mktemp -d); git clone -q ${JSON.stringify(c.origin)} $t/c && cd $t/c && git checkout -q main && echo m > moved.txt && git add . && git commit -qm moved && git push -q origin main\n`);
  chmodSync(p, 0o755); return p;
}
const names = (c) => c.mainFiles();

test('K2 mq-add hook: non-zero exit refuses the add, shows its message, queues nothing', () => {
  const c = setup(); c.ready('a1'); addHook(c, 'mq-add', 'echo "version file missing"; exit 4');
  const r = c.mq('add', '5', 'a1', 'a', 'no');
  assert.notEqual(r.status, 0); assert.match(r.stdout, /REFUSED: ops\/hooks\/mq-add refused PR 5 \(rc=4\)/); assert.match(r.stdout, /version file missing/);
  assert.equal(c.state('a1'), 'started'); assert.equal(c.mq('list').stdout.trim(), 'queue empty');
});

test('K2 mq-add hook: exit 0 accepts; gets <pr> <task-id>, env and cwd = task worktree', () => {
  const c = setup(); const wt = c.ready('a2'); const log = join(c.T, 'hook.log');
  addHook(c, 'mq-add', `echo "args=$1 $2 env=$KOTONE_PR $KOTONE_TASK_ID cwd=$(pwd -P)" >> ${JSON.stringify(log)}`);
  const r = c.mq('add', '6', 'a2', 'a', 'no'); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(c.state('a2'), 'queued');
  assert.equal(readFileSync(log, 'utf8').trim(), `args=6 a2 env=6 a2 cwd=${wt}`);
});

test('K2 mq-add hook: absent (or not executable) is a silent no-op', () => {
  const c = setup(); c.ready('a3');
  const r = c.mq('add', '7', 'a3', 'a', 'no'); assert.equal(r.status, 0); assert.doesNotMatch(r.stdout + r.stderr, /hook/i);
  const c2 = setup(); c2.ready('a4'); chmodSync(addHook(c2, 'mq-add', 'exit 1'), 0o644);
  assert.equal(c2.mq('add', '8', 'a4', 'a', 'no').status, 0);
});

test('K2 pre-merge hook (single): runs with args/env, its commit is checked, pushed and lands on main', () => {
  const c = real(setup()); const log = join(c.T, 'hook.log');
  addHook(c, 'mq-pre-merge', `echo "args=$* list=$KOTONE_PR_LIST batch=$KOTONE_BATCH cwd=$(pwd -P)" >> ${JSON.stringify(log)}\necho v > version.txt; git add version.txt; git commit -qm "assign version"`);
  c.queue([['p1', 41]]);
  const r = c.go(1, { head: 'task/p1' }); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(readFileSync(log, 'utf8'), /^args=41 list=41 batch=0 cwd=.*-mq$/m);
  assert.ok(names(c).includes('version.txt'), 'hook commit is on main'); assert.ok(names(c).includes('p1.txt'));
  assert.deepEqual(c.events(), ['check']);
});

test('K2 pre-merge hook (single): failing hook fails the entry, claim kept, no check, no merge', () => {
  const c = real(setup()); addHook(c, 'mq-pre-merge', 'echo nope; exit 7');
  c.queue([['p2', 42]]);
  const r = c.go(1, { head: 'task/p2' });
  assert.match(r.stdout, /PR 42: failed/); assert.match(r.stdout, /PRE-MERGE HOOK FAILED \(rc=7\)/);
  assert.equal(c.state('p2'), 'failed'); assert.deepEqual(c.events(), []); assert.deepEqual(c.merges(), []);
});

test('K2 pre-merge hook: leaving uncommitted or untracked changes aborts the entry', () => {
  for (const body of ['echo x > stray.txt', 'echo x >> p3.txt']) {
    const c = real(setup()); addHook(c, 'mq-pre-merge', body); c.queue([['p3', 43]]);
    const r = c.go(1, { head: 'task/p3' });
    assert.match(r.stdout, /PR 43: failed/, r.stdout); assert.equal(c.state('p3'), 'failed'); assert.deepEqual(c.events(), []); assert.deepEqual(c.merges(), []);
  }
});

test('K2 batch: 3 PRs, ONE check run, merged in order with --match-head-commit, claims released', () => {
  const c = real(setup()); c.queue([['b1', 51], ['b2', 52], ['b3', 53]]);
  const r = c.go(3); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /BATCH of 3: PRs 51 52 53/);
  assert.deepEqual(c.events(), ['check'], 'exactly one full check');
  const m = c.merges();
  assert.deepEqual(m.map((l) => l.match(/pr merge (\d+)/)[1]), ['51', '52', '53']);
  for (const [i, pr] of [[0, 51], [1, 52], [2, 53]]) {
    const oid = m[i].match(/--match-head-commit (\w{40})/)[1];
    assert.equal(git(c.repo, 'rev-parse', `origin/task/b${pr - 50}`).trim(), oid, 'merged exactly the pushed head');
  }
  assert.deepEqual(['b1.txt', 'b2.txt', 'b3.txt'].filter((f) => !names(c).includes(f)), []);
  assert.deepEqual(c.mainLog().slice(0, 3), ['Merge PR 53', 'Merge PR 52', 'Merge PR 51']);
  for (const id of ['b1', 'b2', 'b3']) assert.ok(!existsSync(c.claimFile(id)), id + ' released');
  assert.equal(c.task('list').stdout.trim(), 'no open tasks');
  // the tree on main equals the tree that was checked
  assert.equal(git(c.repo, 'rev-parse', 'origin/main^{tree}').trim(), git(c.repo, 'rev-parse', 'origin/task/b3^{tree}').trim());
});

test('K2 batch: pre-merge hook runs ONCE, its commit is checked and lands on main', () => {
  const c = real(setup()); const log = join(c.T, 'hook.log');
  addHook(c, 'mq-pre-merge', `echo "list=$KOTONE_PR_LIST batch=$KOTONE_BATCH args=$#" >> ${JSON.stringify(log)}\necho "$KOTONE_PR_LIST" > version.txt; git add version.txt; git commit -qm "assign version"`);
  c.queue([['h1', 61], ['h2', 62]]);
  const r = c.go(2); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(log, 'utf8').trim(), 'list=61 62 batch=1 args=2');
  c.mainFiles(); assert.equal(git(c.repo, 'show', 'origin/main:version.txt').trim(), '61 62');
  assert.deepEqual(c.events(), ['check']); assert.equal(c.merges().length, 2);
});

test('K2 batch: failing pre-merge hook aborts the batch and the entries fall back to singles (which fail on the hook too)', () => {
  const c = real(setup()); addHook(c, 'mq-pre-merge', 'exit 3'); c.queue([['h3', 63], ['h4', 64]]);
  const r = c.go(2);
  assert.match(r.stdout, /BATCH FAILED/); assert.match(r.stdout, /PR 63: failed/); assert.match(r.stdout, /PR 64: failed/);
  assert.deepEqual(c.events(), []); assert.deepEqual(c.merges(), []);
  assert.equal(c.state('h3'), 'failed'); assert.equal(c.state('h4'), 'failed');
});

test('K2 deploy: batch of deploy-yes PRs deploys exactly once, after the last merge', () => {
  const c = real(setup()); c.queue([['d1', 71, 'yes'], ['d2', 72, 'yes'], ['d3', 73, 'yes']]);
  const r = c.go(3); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(c.events(), ['check', 'deploy']);
  assert.equal(c.merges().length, 3); assert.match(r.stdout, /DEPLOY: production deployed once/);
  assert.ok(r.stdout.indexOf('PR 73: merged') < r.stdout.indexOf('DEPLOY: production'));
});

test('K2 deploy: incompatible deploy flags are not batched together; still one deploy per run', () => {
  const c = real(setup()); c.queue([['e1', 81, 'no'], ['e2', 82, 'no'], ['e3', 83, 'yes'], ['e4', 84, 'yes']]);
  const r = c.go(4); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /BATCH of 2: PRs 81 82/); assert.match(r.stdout, /BATCH of 2: PRs 83 84/);
  assert.deepEqual(c.events(), ['check', 'check', 'deploy']);
});

test('K2 deploy: batch of deploy-no PRs never deploys', () => {
  const c = real(setup()); c.queue([['n1', 85], ['n2', 86]]);
  assert.equal(c.go(2).status, 0); assert.deepEqual(c.events(), ['check']);
});

test('K2 guard: main moving after assembly (hook pushes to origin/main) trips the guard; singles take over and all merge', () => {
  const c = real(setup()); const mv = movesMain(c);
  addHook(c, 'mq-pre-merge', `${mv}`);
  c.queue([['g1', 91], ['g2', 92], ['g3', 93]]);
  const r = c.go(3); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /GUARD: origin\/main moved since the batch was assembled/);
  assert.match(r.stdout, /BATCH FAILED/);
  assert.ok(r.stdout.indexOf('GUARD') < r.stdout.indexOf('PR 91: merged'), 'nothing merged before the guard tripped');
  assert.equal(c.merges().length, 3);
  assert.deepEqual(c.events(), ['check', 'check', 'check', 'check'], '1 batch check + 3 single checks');
  assert.deepEqual(['moved.txt', 'g1.txt', 'g2.txt', 'g3.txt'].filter((f) => !names(c).includes(f)), []);
});

test('K2 guard: main moving between two GitHub merges trips the guard; merged ones stay merged, the rest run as singles', () => {
  const c = real(setup()); const mv = movesMain(c);
  c.queue([['k1', 94], ['k2', 95], ['k3', 96]]);
  const r = c.go(3, { KOTONE_FAKE_AFTER_MERGE: mv }); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /GUARD: origin\/main is not the tree of the previous batch head/);
  assert.match(r.stdout, /PR 94: merged \(batch of 3\)/);
  assert.match(r.stdout, /PR 95: merged\b/); assert.match(r.stdout, /PR 96: merged\b/);
  assert.doesNotMatch(r.stdout, /PR 95: merged \(batch/);
  assert.deepEqual(c.events(), ['check', 'check', 'check'], '1 batch check + 2 single checks');
  assert.equal(c.merges().length, 3);
  for (const id of ['k1', 'k2', 'k3']) assert.ok(!existsSync(c.claimFile(id)));
});

test('K2 batch fallback: a PR whose check fails fails alone; the others merge as singles', () => {
  const c = real(setup()); c.ready('f1'); c.ready('f2'); c.ready('f3');
  const wt = join(c.env.KOTONE_WORKTREES, `${SLUG}-f2`);
  writeFileSync(join(wt, 'bad.txt'), 'x'); git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'bad'); git(wt, 'push', '-q', 'origin', 'task/f2');
  c.heads = '101=task/f1,102=task/f2,103=task/f3';
  for (const [id, pr] of [['f1', 101], ['f2', 102], ['f3', 103]]) assert.equal(c.mq('add', String(pr), id, 'a', 'no').status, 0);
  const r = c.go(3); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /CHECK FAILED/); assert.match(r.stdout, /BATCH FAILED/);
  assert.match(r.stdout, /PR 101: merged/); assert.match(r.stdout, /PR 102: failed/); assert.match(r.stdout, /PR 103: merged/);
  assert.deepEqual(c.events(), ['check', 'check', 'check', 'check']);
  assert.equal(c.state('f2'), 'failed'); assert.ok(existsSync(c.claimFile('f2')), 'failed claim kept');
  assert.ok(!existsSync(c.claimFile('f1')) && !existsSync(c.claimFile('f3')));
  assert.ok(!names(c).includes('bad.txt') && names(c).includes('f1.txt') && names(c).includes('f3.txt'));
  assert.deepEqual(c.merges().map((l) => l.match(/pr merge (\d+)/)[1]), ['101', '103']);
});

test('K2 batch fallback: merge conflict between two PRs fails the batch; first merges, second reports a conflict', () => {
  const c = real(setup());
  for (const id of ['x1', 'x2']) { c.task('claim', id, 'a', 't', `src/${id}`); c.task('start', id, '--no-install');
    const wt = join(c.env.KOTONE_WORKTREES, `${SLUG}-${id}`); writeFileSync(join(wt, 'same.txt'), id); git(wt, 'add', '.'); git(wt, 'commit', '-qm', id); git(wt, 'push', '-q', 'origin', `task/${id}`); }
  c.heads = '111=task/x1,112=task/x2';
  c.mq('add', '111', 'x1', 'a', 'no'); c.mq('add', '112', 'x2', 'a', 'no');
  const r = c.go(2);
  assert.match(r.stdout, /CONFLICT merging PR 112/); assert.match(r.stdout, /PR 111: merged/); assert.match(r.stdout, /PR 112: failed/);
  assert.equal(c.state('x2'), 'failed'); assert.equal(c.merges().length, 1);
});

test('K2 default batch 1: per-entry flow exactly as before (one check each, per-entry deploy, no batch text)', () => {
  const c = real(setup()); c.queue([['s1', 121, 'yes'], ['s2', 122, 'yes'], ['s3', 123, 'no']]);
  const r = c.go(1); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /BATCH/);
  assert.deepEqual(c.events(), ['check', 'deploy', 'check', 'deploy', 'check']);
  assert.equal(c.merges().length, 3);
  // and with the variable unset entirely
  const c2 = real(setup()); c2.queue([['s4', 124], ['s5', 125]]);
  assert.equal(c2.go('', {}).status, 0); assert.deepEqual(c2.events(), ['check', 'check']);
});

test('K2 project.conf KOTONE_MQ_BATCH is honored and the environment overrides it', () => {
  const conf = `KOTONE_SLUG="${SLUG}"\nKOTONE_MQ_BATCH="\${KOTONE_MQ_BATCH:-2}"\n`;
  const c = real(setup()); writeFileSync(join(c.repo, 'ops/project.conf'), conf);
  c.queue([['c1', 131], ['c2', 132]]);
  const r = sh(c.repo, `unset KOTONE_MQ_BATCH; ${join(c.repo, 'scripts/ops/mq.sh')} run`, { ...c.env, KOTONE_MQ_DRYRUN: '', KOTONE_FAKE_ORIGIN: c.origin, KOTONE_FAKE_HEADS: c.heads, KOTONE_FAKE_LOG: c.ghlog, KOTONE_TEST_LOG: c.log });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /BATCH of 2/); assert.deepEqual(c.events(), ['check']);
  const c2 = real(setup()); writeFileSync(join(c2.repo, 'ops/project.conf'), conf); c2.queue([['c3', 133], ['c4', 134]]);
  const r2 = c2.go(1); assert.equal(r2.status, 0); assert.doesNotMatch(r2.stdout, /BATCH/); assert.deepEqual(c2.events(), ['check', 'check']);
});

test('K2 review gate: no comment refuses (default on), nothing queued', () => {
  const c = setup(); c.ready('r1'); const sha = 'a'.repeat(40);
  const env = { KOTONE_MQ_REQUIRE_REVIEW: '', KOTONE_FAKE_REVIEW_HEAD: sha };
  const r = sh(c.repo, `scripts/ops/mq.sh add 9 r1 a no`, { ...c.env, ...env });
  assert.notEqual(r.status, 0); assert.match(r.stdout, /REFUSED: PR 9 has no review for its current head/); assert.match(r.stdout, new RegExp(`reviewed ${sha}`));
  assert.equal(c.state('r1'), 'started');
});

function reviewed(c, comments, extra = {}) {
  const f = join(c.T, 'comments'); writeFileSync(f, comments.map((x) => JSON.stringify(x)).join('\n') + '\n');
  return sh(c.repo, 'scripts/ops/mq.sh add 9 r2 a no', { ...c.env, KOTONE_MQ_REQUIRE_REVIEW: '1', KOTONE_FAKE_COMMENTS: f, ...extra });
}
test('K2 review gate: stale sha, extra text, or a multi-line body refuse', () => {
  const sha = 'b'.repeat(40), old = 'c'.repeat(40);
  for (const comments of [[`reviewed ${old}`], [`reviewed ${sha} thanks`], [`reviewed ${sha}\nand more`], [`Reviewed ${sha}`], [`reviewed ${sha.slice(0, 12)}`]]) {
    const c = setup(); c.ready('r2');
    const r = reviewed(c, comments, { KOTONE_FAKE_REVIEW_HEAD: sha });
    assert.notEqual(r.status, 0, JSON.stringify(comments)); assert.match(r.stdout, /REFUSED/); assert.equal(c.state('r2'), 'started');
  }
});
test('K2 review gate: a comment exactly "reviewed <current head sha>" passes', () => {
  const c = setup(); c.ready('r2'); const sha = 'd'.repeat(40);
  const r = reviewed(c, ['looks fine', `reviewed ${'e'.repeat(40)}`, `reviewed ${sha}`], { KOTONE_FAKE_REVIEW_HEAD: sha });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(c.state('r2'), 'queued');
});
test('K2 review gate: waive works for exactly that PR; REQUIRE_REVIEW=0 skips', () => {
  const sha = 'f'.repeat(40);
  const c = setup(); c.ready('r2');
  assert.notEqual(reviewed(c, [], { KOTONE_FAKE_REVIEW_HEAD: sha, KOTONE_MQ_REVIEW_WAIVE: '10' }).status, 0, 'waiver for another PR');
  const w = reviewed(c, [], { KOTONE_FAKE_REVIEW_HEAD: sha, KOTONE_MQ_REVIEW_WAIVE: '9' });
  assert.equal(w.status, 0, w.stdout); assert.match(w.stdout, /WARNING: review gate waived for PR 9/);
  const c2 = setup(); c2.ready('r2');
  assert.equal(reviewed(c2, [], { KOTONE_MQ_REQUIRE_REVIEW: '0' }).status, 0);
});
test('K2 review gate: fails closed when gh cannot be read or returns no head', () => {
  const sha = '1'.repeat(40);
  const c = setup(); c.ready('r2');
  const r = reviewed(c, [`reviewed ${sha}`], { KOTONE_FAKE_REVIEW_HEAD: sha, KOTONE_FAKE_GHFAIL: '1' });
  assert.notEqual(r.status, 0); assert.match(r.stdout, /REFUSED: cannot read the comments/);
  const r2 = reviewed(c, [`reviewed ${sha}`], { KOTONE_FAKE_REVIEW_HEAD: '' });
  assert.notEqual(r2.status, 0); assert.match(r2.stdout, /REFUSED: GitHub did not return a 40-char head/);
  assert.equal(c.state('r2'), 'started');
});
test('K2 review gate runs before the mq-add hook (a refused review never reaches the hook)', () => {
  const c = setup(); c.ready('r2'); const log = join(c.T, 'hook.log'); addHook(c, 'mq-add', `echo ran >> ${JSON.stringify(log)}`);
  assert.notEqual(reviewed(c, [], { KOTONE_FAKE_REVIEW_HEAD: '2'.repeat(40) }).status, 0);
  assert.ok(!existsSync(log));
});

// ---- K6 Part B: worktree-removal guard ---------------------------------------------------------------------------
const removals = (c) => { const p = join(c.env.KOTONE_OPS_DIR, 'worktree-removals.log'); return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean) : []; };

test('K6 worktree: release appends one removal-log line (time, id, path, caller, agent, parent chain, result)', () => {
  const c = setup(); const wt = c.ready('w1');
  const r = sh(c.repo, 'scripts/ops/task.sh release w1', { ...c.env, KOTONE_AGENT: 'agent-z' });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.ok(!existsSync(wt));
  const l = removals(c); assert.equal(l.length, 1, l.join('\n'));
  const f = l[0].split(' | ');
  assert.equal(f.length, 7, l[0]);
  assert.match(f[0], /^\d{4}-\d\d-\d\dT/); assert.equal(f[1], 'w1'); assert.equal(f[2], wt); assert.equal(f[3], 'task.sh release');
  assert.equal(f[4], 'agent-z'); assert.match(f[5], /^\d+:\S+/); assert.equal(f[6], 'removed');
});

test('K6 worktree: a kept worktree (caller runs inside it) is logged as kept, not removed', () => {
  const c = setup(); const wt = c.ready('w2');
  const r = sh(wt, `${join(wt, 'scripts/ops/task.sh')} release w2`, c.env);
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.ok(existsSync(wt));
  assert.match(removals(c).join('\n'), /\| w2 \| .* \| kept: /);
});

test('K6 worktree: remove_worktree refuses when the claim is missing, and logs the refusal', () => {
  const c = setup(); const wt = c.ready('w3');
  const r = sh(c.repo, `. scripts/ops/lib.sh && remove_worktree nope ${JSON.stringify(wt)} test-caller`, c.env);
  assert.notEqual(r.status, 0); assert.match(r.stdout, /REFUSED to remove worktree .*no claim file for task nope/);
  assert.ok(existsSync(wt), 'worktree untouched');
  assert.match(removals(c).join('\n'), /\| nope \| .* \| test-caller \| .* \| REFUSED: no claim file/);
});

test('K6 worktree: remove_worktree refuses when the path differs from the claim, or is the main checkout, or the state forbids release', () => {
  const c = setup(); const wt = c.ready('w4'); const other = join(c.env.KOTONE_WORKTREES, 'other');
  git(c.repo, 'worktree', 'add', '-q', other, '-b', 'other');
  let r = sh(c.repo, `. scripts/ops/lib.sh && remove_worktree w4 ${JSON.stringify(other)} t`, c.env);
  assert.notEqual(r.status, 0); assert.match(r.stdout, /claim records worktree/); assert.ok(existsSync(other));
  r = sh(c.repo, `. scripts/ops/lib.sh && remove_worktree w4 ${JSON.stringify(c.repo)} t`, c.env);
  assert.notEqual(r.status, 0); assert.ok(existsSync(c.repo));
  // state queued: not allowed (set the claim's recorded worktree to the repo so only the state can refuse)
  c.mq('add', '5', 'w4', 'a', 'no'); assert.equal(c.state('w4'), 'queued');
  r = sh(c.repo, `. scripts/ops/lib.sh && remove_worktree w4 ${JSON.stringify(wt)} t`, c.env);
  assert.notEqual(r.status, 0); assert.match(r.stdout, /state queued does not allow release/); assert.ok(existsSync(wt));
  assert.equal(removals(c).length, 3);
});

test('K6 worktree: start records worktree-created in the claim and writes an untracked, git-ignored .kotone-task marker', () => {
  const c = setup(); const wt = c.ready('w5');
  assert.equal(readFileSync(join(wt, '.kotone-task'), 'utf8').trim(), 'w5');
  assert.match(readFileSync(c.claimFile('w5'), 'utf8'), new RegExp(`^worktree-created: ${wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d{4}-`, 'm'));
  assert.equal(git(wt, 'status', '--porcelain').trim(), '', 'marker is ignored: the tree stays clean');
  assert.equal(git(wt, 'ls-files', '--', '.kotone-task').trim(), '');
});

test('K6 worktree: verify and list flag MISSING after the worktree directory is deleted externally', () => {
  const c = setup(); const wt = c.ready('w6');
  assert.equal(c.task('verify', 'w6').status, 0);
  assert.doesNotMatch(c.task('list').stdout, /MISSING/);
  sh(c.T, `rm -rf ${JSON.stringify(wt)}`);
  const v = c.task('verify', 'w6');
  assert.equal(v.status, 1); assert.match(v.stdout, /MISSING: task w6 \(started\): worktree .* is gone/); assert.match(v.stdout, /git worktree add -f -f .* task\/w6/);
  assert.match(c.task('list').stdout, /w6 \| started .*MISSING WORKTREE/);
  assert.equal(c.task('verify').status, 1, 'verify with no id checks all claims');
  // the hint works
  git(c.repo, 'worktree', 'add', '-f', '-f', wt, 'task/w6');
  assert.equal(c.task('verify', 'w6').status, 0);
});

// ---- K6 Part A: mq.sh hardening ------------------------------------------------------------------------------------
const originHead = (c, id) => { git(c.repo, 'fetch', '-q', 'origin'); return git(c.repo, 'rev-parse', `origin/task/${id}`).trim(); };
// add `id` as PR `pr` with a real "reviewed <head>" comment (gate ON at add time)
function addReviewed(c, id, pr) {
  const sha = originHead(c, id), f = join(c.T, `comments-${id}`);
  writeFileSync(f, JSON.stringify(`reviewed ${sha}`) + '\n');
  const r = sh(c.repo, `scripts/ops/mq.sh add ${pr} ${id} a no`, { ...c.env, KOTONE_MQ_REQUIRE_REVIEW: '1', KOTONE_FAKE_COMMENTS: f, KOTONE_FAKE_REVIEW_HEAD: sha });
  assert.equal(r.status, 0, r.stdout + r.stderr); return sha;
}
// the task branch gets one more commit after it was queued
function pushMore(c, id) { const wt = join(c.env.KOTONE_WORKTREES, `${SLUG}-${id}`); writeFileSync(join(wt, `${id}-more.txt`), 'more'); git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'more'); git(wt, 'push', '-q', 'origin', `task/${id}`); }
const GATE_ON = { KOTONE_MQ_REQUIRE_REVIEW: '1', KOTONE_MQ_BACKOFF: '0' };
const failsOnce = (c) => ({ KOTONE_FAKE_MERGE_FAIL: '1', KOTONE_MQ_BACKOFF: '0' });

test('K6 guard (single): main moving during the mergeability wait is not merged blind: re-merge main, re-check, then merge', () => {
  const c = real(setup()); c.queue([['s1', 301]]); const mv = movesMain(c);
  const r = c.go(1, { KOTONE_FAKE_ON_WAIT: mv }); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout + readFileSync(join(c.env.KOTONE_OPS_DIR, 'logs', readdirSync(join(c.env.KOTONE_OPS_DIR, 'logs')).find((n) => /^pr301-/.test(n))), 'utf8'), /origin\/main moved/);
  assert.deepEqual(c.events(), ['check', 'check'], 'the new main tree was checked before it was merged');
  const m = c.merges(); assert.equal(m.length, 1);
  const oid = m[0].match(/--match-head-commit (\w{40})/)[1];
  assert.ok(git(c.repo, 'ls-tree', '-r', '--name-only', oid).includes('moved.txt'), 'merged head contains the moved main');
  assert.deepEqual(['moved.txt', 's1.txt'].filter((f) => !names(c).includes(f)), []);
});
test('K6 guard (single): main moving after "Base branch was modified" restarts the entry instead of retrying the stale head', () => {
  const c = real(setup()); c.queue([['s2', 302]]); const mv = movesMain(c);
  const r = c.go(1, { ...failsOnce(c), KOTONE_FAKE_ON_FAIL: mv }); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(c.events(), ['check', 'check']);
  const oid = c.merges()[0].match(/--match-head-commit (\w{40})/)[1];
  assert.ok(git(c.repo, 'ls-tree', '-r', '--name-only', oid).includes('moved.txt'));
  assert.ok(!existsSync(c.claimFile('s2')));
});
test('K6 guard (batch): main moving during a merge retry trips the guard; the batch stops and singles take over', () => {
  const c = real(setup()); c.queue([['s3', 303], ['s4', 304]]); const mv = movesMain(c);
  const r = c.go(2, { ...failsOnce(c), KOTONE_FAKE_ON_FAIL: mv }); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /BATCH FAILED/);
  assert.match(readdirSync(join(c.env.KOTONE_OPS_DIR, 'logs')).filter((n) => /^batch-/.test(n)).map((n) => readFileSync(join(c.env.KOTONE_OPS_DIR, 'logs', n), 'utf8')).join(''), /GUARD: origin\/main moved/);
  assert.equal(c.merges().length, 2); assert.equal(c.events().length, 3, '1 batch check + 2 single checks');
  assert.deepEqual(['moved.txt', 's3.txt', 's4.txt'].filter((f) => !names(c).includes(f)), []);
});

test('K6 review at run (single): a PR that got new commits after it was queued is refused, not merged', () => {
  const c = real(setup()); c.ready('v1'); addReviewed(c, 'v1', 311); c.heads = '311=task/v1'; pushMore(c, 'v1');
  const r = c.go(1, GATE_ON); assert.match(r.stdout, /REFUSED: PR 311 head is \w{40} but the reviewed commit is \w{40}: new commits/);
  assert.equal(c.merges().length, 0); assert.deepEqual(c.events(), []); assert.equal(c.state('v1'), 'failed');
});
test('K6 review at run (single): the reviewed head merges, and transient retries on the runner\'s own pushed head keep working', () => {
  const c = real(setup()); c.ready('v2'); addReviewed(c, 'v2', 312); c.heads = '312=task/v2';
  const env = { ...GATE_ON, KOTONE_FAKE_MERGE_FAIL: '3' };
  const r1 = c.go(1, env); assert.match(r1.stdout, /merge not accepted yet \(transient\)/); assert.equal(c.state('v2'), 'queued');
  const r2 = c.go(1, env); assert.equal(r2.status, 0, r2.stdout + r2.stderr); assert.match(r2.stdout, /PR 312: merged/);
  assert.equal(c.merges().length, 1);
});
test('K6 review at run (single): an entry queued while the gate was off is refused once the gate is on', () => {
  const c = real(setup()); c.queue([['v3', 313]]);  // added with KOTONE_MQ_REQUIRE_REVIEW=0
  const r = c.go(1, GATE_ON); assert.match(r.stdout, /REFUSED: PR 313 was queued while the review gate was off/);
  assert.equal(c.merges().length, 0);
});
test('K6 review at run (single): a waived entry still merges', () => {
  const c = real(setup()); c.ready('v4'); c.heads = '314=task/v4';
  const r0 = sh(c.repo, 'scripts/ops/mq.sh add 314 v4 a no', { ...c.env, KOTONE_MQ_REQUIRE_REVIEW: '1', KOTONE_MQ_REVIEW_WAIVE: '314', KOTONE_FAKE_REVIEW_HEAD: 'a'.repeat(40) });
  assert.equal(r0.status, 0, r0.stdout + r0.stderr);
  const r = c.go(1, GATE_ON); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(c.merges().length, 1);
});
test('K6 review at run (batch): a PR with new commits aborts the batch; the reviewed one merges, the changed one is refused', () => {
  const c = real(setup()); c.ready('v5'); c.ready('v6'); addReviewed(c, 'v5', 315); addReviewed(c, 'v6', 316); c.heads = '315=task/v5,316=task/v6'; pushMore(c, 'v6');
  const r = c.go(2, GATE_ON);
  assert.match(r.stdout, /BATCH FAILED/); assert.match(r.stdout, /REFUSED: PR 316 head/);
  assert.deepEqual(c.merges().map((l) => l.match(/pr merge (\d+)/)[1]), ['315']);
  assert.equal(c.state('v6'), 'failed'); assert.ok(!existsSync(c.claimFile('v5')), 'reviewed one released');
});

test('K6 restore: after a post-push batch failure every PR head is put back, so no single can carry another PR\'s commits', () => {
  const c = real(setup()); c.queue([['r1', 321], ['r2', 322], ['r3', 323]]);
  const orig = ['r1', 'r2', 'r3'].map((id) => originHead(c, id));
  const r = c.go(3, { KOTONE_FAKE_MERGE_FAIL: '100', KOTONE_MQ_BACKOFF: '0' });
  assert.match(r.stdout, /BATCH FAILED/);
  const logs = readdirSync(join(c.env.KOTONE_OPS_DIR, 'logs')).filter((n) => /^batch-/.test(n)).map((n) => readFileSync(join(c.env.KOTONE_OPS_DIR, 'logs', n), 'utf8')).join('');
  assert.ok((logs.match(/RESTORED the head of PR/g) || []).length >= 2, logs);  // PR 1's pushed head equals its original (main is its ancestor): nothing to restore
  assert.equal(c.merges().length, 0);
  // the singles that ran after the batch pushed their own heads; each PR branch holds only its own commit on top of main
  for (const id of ['r1', 'r2', 'r3']) {
    const others = ['r1', 'r2', 'r3'].filter((x) => x !== id).map((x) => `${x}.txt`);
    const files = git(c.repo, 'ls-tree', '-r', '--name-only', originHead(c, id)).trim().split('\n');
    assert.deepEqual(others.filter((f) => files.includes(f)), [], `${id} must not carry other PRs' commits`);
  }
  assert.equal(originHead(c, 'r1'), orig[0]);
});
test('K6 restore: when a pushed head cannot be restored the entries fail loudly instead of falling back to singles', () => {
  const c = real(setup()); c.queue([['q1', 331], ['q2', 332]]);
  const hook = join(c.T, 'push-other.sh'), mark = join(c.T, 'push-other.done');
  writeFileSync(hook, `#!/usr/bin/env bash\n[ -e ${JSON.stringify(mark)} ] && exit 0\ntouch ${JSON.stringify(mark)}\nt=$(mktemp -d); git clone -q ${JSON.stringify(c.origin)} $t/c && cd $t/c && git checkout -q task/q1 && echo x > intruder.txt && git add . && git commit -qm intruder && git push -q origin task/q1\n`);
  chmodSync(hook, 0o755);
  const r = c.go(2, { KOTONE_FAKE_MERGE_FAIL: '100', KOTONE_MQ_BACKOFF: '0', KOTONE_FAKE_ON_FAIL: hook });
  assert.match(r.stdout, /ERROR: PR 331 FAILED: the batch failed after pushing and its PR heads could not all be restored/);
  assert.match(r.stderr, /PR 331 FAILED/);
  assert.equal(c.state('q1'), 'failed'); assert.equal(c.state('q2'), 'failed');
  assert.deepEqual(c.events(), ['check'], 'no single ran after the failed restore'); assert.equal(c.merges().length, 0);
  assert.equal(c.mq('list').stdout.trim(), 'queue empty');
});

test('K6 clean tree after the check (single and batch): a check that leaves files behind aborts before push and merge', () => {
  for (const batch of [1, 2]) {
    const c = real(setup());
    writeFileSync(join(c.repo, 'scripts/check.sh'), '#!/usr/bin/env bash\n[[ "$1" == --fast ]] || { echo check >> "$KOTONE_TEST_LOG"; echo x > left-by-check.txt; }\nexit 0\n');
    git(c.repo, 'add', '.'); git(c.repo, 'commit', '-qm', 'dirty check'); git(c.repo, 'push', '-q', 'origin', 'main');
    c.queue([['d1', 341 + batch * 10], ['d2', 342 + batch * 10]]);
    const r = c.go(batch);
    assert.match(r.stdout, /check.sh left uncommitted or untracked changes|rc=32/, `batch=${batch}\n${r.stdout}`);
    assert.equal(c.merges().length, 0, `batch=${batch}`); assert.equal(c.state('d1'), 'failed');
  }
});

test('K6 warnings: review gate off, waiver and an overridden gh outside test mode warn on stderr', () => {
  const c = setup(); c.ready('x1');
  const off = sh(c.repo, 'scripts/ops/mq.sh add 9 x1 a no', c.env);   // setup() runs with KOTONE_MQ_REQUIRE_REVIEW=0
  assert.match(off.stderr, /^WARNING: KOTONE_MQ_REQUIRE_REVIEW=0: the review gate is OFF/m);
  const c2 = setup(); c2.ready('x2');
  const wv = sh(c2.repo, 'scripts/ops/mq.sh add 9 x2 a no', { ...c2.env, KOTONE_MQ_REQUIRE_REVIEW: '1', KOTONE_MQ_REVIEW_WAIVE: '9', KOTONE_FAKE_REVIEW_HEAD: 'a'.repeat(40) });
  assert.match(wv.stderr, /^WARNING: KOTONE_MQ_REVIEW_WAIVE=9 is set/m);
  const env = { ...c.env }; delete env.KOTONE_OPS_DIR;
  const real_ = sh(c.repo, 'scripts/ops/mq.sh add 9 nope a no', env);
  assert.match(real_.stderr, /^WARNING: KOTONE_MQ_GH=.* replaces the gh binary against the REAL queue/m);
  assert.doesNotMatch(sh(c.repo, 'scripts/ops/mq.sh add 9 nope a no', c.env).stderr, /replaces the gh binary/, 'isolated KOTONE_OPS_DIR = test mode, no warning');
  assert.doesNotMatch(sh(c.repo, 'scripts/ops/mq.sh list', c.env).stderr, /WARNING/, 'read-only commands stay quiet');
});
test('K6 warnings: a hook file that is not executable is warned about (and ignored)', () => {
  const c = setup(); c.ready('x3');
  mkdirSync(join(c.repo, 'ops/hooks'), { recursive: true }); writeFileSync(join(c.repo, 'ops/hooks/mq-add'), '#!/usr/bin/env bash\nexit 1\n');
  const r = c.mq('add', '9', 'x3', 'a', 'no');
  assert.equal(r.status, 0, 'not executable = ignored'); assert.match(r.stderr, /WARNING: hook .*ops\/hooks\/mq-add exists but is not executable: IGNORED/);
});

// ---- K7: KOTONE_MQ_DEPLOY_CHECK / KOTONE_MQ_DEPLOY_ARG ---------------------------------------------------------
// check.sh stub logs "fast" or "full" for every run; deploy.sh stub logs "deploy:<first arg>".
function deployStubs(c) {
  writeFileSync(join(c.repo, 'scripts/check.sh'), '#!/usr/bin/env bash\nif [[ "$1" == --fast ]]; then echo fast >> "$KOTONE_TEST_LOG"; else echo full >> "$KOTONE_TEST_LOG"; fi\nexit 0\n');
  writeFileSync(join(c.repo, 'scripts/deploy.sh'), '#!/usr/bin/env bash\necho "deploy:$1" >> "$KOTONE_TEST_LOG"\nexit 0\n');
  git(c.repo, 'add', '.'); git(c.repo, 'commit', '-qm', 'k7 stubs'); git(c.repo, 'push', '-q', 'origin', 'main');
  return c;
}

test('K7 deploy check: default (fast) is unchanged: queue full check, then --fast on main, then deploy production', () => {
  const c = deployStubs(real(setup())); c.queue([['k1', 201, 'yes']]);
  const r = c.go(1); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(c.events(), ['full', 'fast', 'deploy:production']);
  assert.match(r.stdout, /merged \+ deployed/);
});

test('K7 deploy check none: skips the check and deploys when main tree equals the checked tree', () => {
  const c = deployStubs(real(setup())); c.queue([['k2', 202, 'yes']]);
  const r = c.go(1, { KOTONE_MQ_DEPLOY_CHECK: 'none' }); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(c.events(), ['full', 'deploy:production']);
  assert.match(r.stdout, /merged \+ deployed/);
});

test('K7 deploy check none: refuses to deploy when main moved to a different tree', () => {
  const c = deployStubs(real(setup())); c.queue([['k3', 203, 'yes']]);
  const r = c.go(1, { KOTONE_MQ_DEPLOY_CHECK: 'none', KOTONE_FAKE_AFTER_MERGE: movesMain(c) });
  assert.equal(c.events().includes('deploy:production'), false, c.events().join());
  assert.deepEqual(c.events(), ['full']);
  assert.match(r.stdout, /DEPLOY FAILED/);
  assert.match(readFileSync(join(c.T, 'ops') + '/logs/' + readdirSync(join(c.T, 'ops') + '/logs')[0], 'utf8'), /DEPLOY REFUSED/);
});

test('K7 deploy check full: runs the full check on main before deploying', () => {
  const c = deployStubs(real(setup())); c.queue([['k4', 204, 'yes']]);
  const r = c.go(1, { KOTONE_MQ_DEPLOY_CHECK: 'full' }); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(c.events(), ['full', 'full', 'deploy:production']);
});

test('K7 deploy arg: KOTONE_MQ_DEPLOY_ARG is passed to deploy.sh as its first argument', () => {
  const c = deployStubs(real(setup())); c.queue([['k5', 205, 'yes']]);
  const r = c.go(1, { KOTONE_MQ_DEPLOY_ARG: 'live' }); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(c.events(), ['full', 'fast', 'deploy:live']);
});

// ---- K8: K7 review follow-ups (batch flow, missing checked tree, unknown value) --------------------------------
const deployLog = (c) => { const d = join(c.T, 'ops', 'logs'); return readdirSync(d).map((n) => readFileSync(join(d, n), 'utf8')).join('\n'); };

test('K8 deploy check none (batch of 2): deploys once when main tree equals the recorded batch tree', () => {
  const c = deployStubs(real(setup())); c.queue([['b1', 301, 'yes'], ['b2', 302, 'yes']]);
  const r = c.go(2, { KOTONE_MQ_DEPLOY_CHECK: 'none' }); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /BATCH of 2/);
  assert.deepEqual(c.events(), ['full', 'deploy:production']);
  assert.match(r.stdout, /DEPLOY: production deployed once/);
});

test('K8 deploy check none: a missing checked-tree record refuses the deploy ("no checked tree recorded")', () => {
  const c = deployStubs(real(setup())); c.queue([['k6', 306, 'yes']]);
  const rm = join(c.T, 'rm-checked.sh');
  writeFileSync(rm, `#!/usr/bin/env bash\nrm -f ${JSON.stringify(join(c.T, 'ops', 'checked-tree'))}\n`); chmodSync(rm, 0o755);
  const r = c.go(1, { KOTONE_MQ_DEPLOY_CHECK: 'none', KOTONE_FAKE_AFTER_MERGE: rm });
  assert.equal(c.events().includes('deploy:production'), false, c.events().join());
  assert.match(r.stdout, /DEPLOY FAILED/);
  assert.match(deployLog(c), /DEPLOY REFUSED: .*no checked tree is recorded/);
});

test('K8 deploy check: an unknown KOTONE_MQ_DEPLOY_CHECK value is refused, deploy not called', () => {
  const c = deployStubs(real(setup())); c.queue([['k7', 307, 'yes']]);
  const r = c.go(1, { KOTONE_MQ_DEPLOY_CHECK: 'bogus' });
  assert.equal(c.events().includes('deploy:production'), false, c.events().join());
  assert.deepEqual(c.events(), ['full']);
  assert.match(r.stdout, /DEPLOY FAILED/);
  assert.match(deployLog(c), /DEPLOY REFUSED: unknown KOTONE_MQ_DEPLOY_CHECK='bogus'/);
});

// ---- mq-deploy-norm: deploy flag normalized at add, loud at run; released claim tolerated ------------------------
test('mq-deploy-norm add: deploy:yes / deploy:no normalize to yes / no and list shows the normalized value', () => {
  const c = deployStubs(real(setup()));
  c.ready('n1'); c.ready('n2'); c.ready('n3');
  assert.equal(c.mq('add', '401', 'n1', 'a', 'deploy:yes').status, 0);
  assert.equal(c.mq('add', '402', 'n2', 'a', 'deploy:no').status, 0);
  assert.equal(c.mq('add', '403', 'n3', 'a').status, 0, 'omitted flag keeps its default (yes)');
  const l = c.mq('list').stdout;
  assert.match(l, /PR 401 .*\| deploy yes \|/); assert.match(l, /PR 402 .*\| deploy no \|/); assert.match(l, /PR 403 .*\| deploy yes \|/);
  assert.doesNotMatch(l, /deploy:/);
});

test('mq-deploy-norm add: deploy:yes PR actually deploys after merge (was silently skipped)', () => {
  const c = deployStubs(real(setup())); c.queue([['n4', 404, 'deploy:yes']]);
  const r = c.go(1); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(c.events().includes('deploy:production'), c.events().join());
  assert.match(r.stdout, /merged \+ deployed/);
});

test('mq-deploy-norm add: an unknown deploy flag is refused with a clear message, nothing queued, claim stays started', () => {
  const c = deployStubs(real(setup())); c.ready('n5');
  const r = c.mq('add', '405', 'n5', 'a', 'maybe');
  assert.notEqual(r.status, 0); assert.match(r.stdout, /REFUSED: deploy flag 'maybe' is not one of yes\|no\|deploy:yes\|deploy:no/);
  assert.equal(c.state('n5'), 'started'); assert.equal(c.mq('list').stdout.trim(), 'queue empty');
});

test('mq-deploy-norm run: an unknown stored deploy value fails the entry loudly before merging (never a silent skip)', () => {
  const c = deployStubs(real(setup())); c.queue([['n6', 406, 'yes']]);
  const q = join(c.env.KOTONE_OPS_DIR, 'queue'); const qf = join(q, readdirSync(q)[0]);
  writeFileSync(qf, readFileSync(qf, 'utf8').replace(/^deploy: .*$/m, 'deploy: maybe'));
  assert.match(c.mq('list').stdout, /deploy INVALID:maybe/);
  const r = c.go(1);
  assert.match(r.stdout, /ERROR: PR 406: invalid stored deploy value 'maybe'/);
  assert.match(r.stdout, /PR 406: failed/);
  assert.equal(c.merges().length, 0, 'nothing merged'); assert.deepEqual(c.events(), []);
  assert.equal(c.state('n6'), 'failed');
});

test('mq-deploy-norm run: a legacy stored "deploy:yes" is honored (deploys), not skipped', () => {
  const c = deployStubs(real(setup())); c.queue([['n7', 407, 'yes']]);
  const q = join(c.env.KOTONE_OPS_DIR, 'queue'); const qf = join(q, readdirSync(q)[0]);
  writeFileSync(qf, readFileSync(qf, 'utf8').replace(/^deploy: .*$/m, 'deploy: deploy:yes'));
  const r = c.go(1); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(c.events().includes('deploy:production'), c.events().join());
});

test('mq-deploy-norm release: a claim already released after a good merge is tolerated (rc 0, no RELEASE FAILED)', () => {
  const c = deployStubs(real(setup())); c.queue([['n8', 408, 'no']]);
  // released by hand right after the merge: claim moved to done/ with state released
  const hook = join(c.T, 'hand-release.sh');
  const ops = c.env.KOTONE_OPS_DIR;
  writeFileSync(hook, `#!/usr/bin/env bash\nmkdir -p ${JSON.stringify(ops + '/done')}\nsed 's/^state: .*/state: released/' ${JSON.stringify(ops + '/claims/n8')} > ${JSON.stringify(ops + '/done/n8')}\nrm -f ${JSON.stringify(ops + '/claims/n8')}\n`);
  chmodSync(hook, 0o755);
  const r = c.go(1, { KOTONE_FAKE_AFTER_MERGE: hook });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /RELEASE FAILED/);
  assert.match(r.stdout, /PR 408: merged/);
});

// ---- mq-runlog: run log, priority, fix-up rule, fast stamp -----------------------------------------------------
const runlog = (c) => { const p = join(c.env.KOTONE_OPS_DIR, 'mq-log'); return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split('\t')) : []; };
// columns: 0 finished 1 pr 2 task 3 agent 4 added 5 started 6 wait 7 check 8 result 9 cause 10 batch id 11 batch size 12 sha 13 deploy 14 deploy_s 15 note
// a branch that edits clash.txt, with main moved on to a different clash.txt afterwards (merge conflict)
function conflicting(c, id) {
  c.ready(id); const wt = join(c.env.KOTONE_WORKTREES, `${SLUG}-${id}`);
  writeFileSync(join(wt, 'clash.txt'), 'branch'); git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'c'); git(wt, 'push', '-q', 'origin', `task/${id}`);
  const t = join(c.T, `main-edit-${id}`); git(c.T, 'clone', '-q', c.origin, t); git(t, 'checkout', '-q', 'main');
  writeFileSync(join(t, 'clash.txt'), 'main'); git(t, 'add', '.'); git(t, 'commit', '-qm', 'm'); git(t, 'push', '-q', 'origin', 'main');
}
function badCheck(c, id) {
  c.ready(id); const wt = join(c.env.KOTONE_WORKTREES, `${SLUG}-${id}`);
  writeFileSync(join(wt, 'bad.txt'), 'x'); git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'bad'); git(wt, 'push', '-q', 'origin', `task/${id}`);
}

test('mq-runlog: a merged single entry logs one line with timings, sha, deploy and no failure cause', () => {
  const c = real(setup()); c.queue([['l1', 501, 'yes']]);
  const r = c.go(1); assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = runlog(c); assert.equal(rows.length, 1); const [row] = rows;
  assert.equal(row.length, 16); assert.equal(row[1], '501'); assert.equal(row[2], 'l1'); assert.equal(row[3], 'a'); assert.equal(row[8], 'merged'); assert.equal(row[9], '-');
  assert.match(row[6], /^\d+$/); assert.match(row[7], /^\d+$/); assert.equal(row[11], '1'); assert.equal(row[12], originHead(c, 'l1'));
  assert.equal(row[13], 'yes'); assert.match(row[14], /^\d+$/); assert.equal(row[15], '-');
});
test('mq-runlog: a check failure logs check-failed with its cause', () => {
  const c = real(setup()); badCheck(c, 'l2'); c.heads = '511=task/l2';
  assert.equal(c.mq('add', '511', 'l2', 'a', 'no').status, 0);
  assert.equal(c.go(1).status, 0);
  const [row] = runlog(c); assert.equal(row[8], 'check-failed'); assert.match(row[9], /CHECK FAILED/); assert.equal(row[12], '-'); assert.match(row[7], /^\d+$/);
});
test('mq-runlog: a merge conflict logs conflict with its cause', () => {
  const c = real(setup()); conflicting(c, 'l3'); c.heads = '512=task/l3';
  assert.equal(c.mq('add', '512', 'l3', 'a', 'no').status, 0);
  assert.equal(c.go(1).status, 0);
  const [row] = runlog(c); assert.equal(row[8], 'conflict'); assert.match(row[9], /CONFLICT/);
});
test('mq-runlog: an entry refused at run (queued with the gate off, run with it on) logs refused', () => {
  const c = real(setup()); c.queue([['l4', 513]]);
  assert.equal(c.go(1, { KOTONE_MQ_REQUIRE_REVIEW: '1' }).status, 0);
  const [row] = runlog(c); assert.equal(row[8], 'refused'); assert.match(row[9], /REFUSED/);
});
test('mq-runlog: a batch logs batch id and size for every member, one check time, and one deploy time', () => {
  const c = real(setup()); c.queue([['l5', 531, 'yes'], ['l6', 532, 'yes']]);
  const r = c.go(2); assert.equal(r.status, 0, r.stdout + r.stderr);
  const rows = runlog(c); assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((x) => x[8]), ['merged', 'merged']); assert.equal(rows[0][10], rows[1][10]); assert.match(rows[0][10], /^batch-531-\d+$/);
  assert.deepEqual(rows.map((x) => x[11]), ['2', '2']); assert.equal(rows[0][7], rows[1][7]); assert.match(rows[0][7], /^\d+$/);
  assert.match(rows[0][14], /^\d+$/); assert.equal(rows[0][14], rows[1][14]);
  assert.match(rows[0][12], /^[0-9a-f]{40}$/); assert.notEqual(rows[0][12], rows[1][12]);
});
test('mq-runlog: a failed deploy is logged as deploy-failed; the log path is overridable', () => {
  const c = real(setup());
  writeFileSync(join(c.repo, 'scripts/deploy.sh'), '#!/usr/bin/env bash\nexit 3\n'); git(c.repo, 'add', '.'); git(c.repo, 'commit', '-qm', 'bad deploy'); git(c.repo, 'push', '-q', 'origin', 'main');
  c.queue([['l7', 541, 'yes']]);
  const alt = join(c.T, 'elsewhere', 'my-log');
  c.go(1, { KOTONE_MQ_LOG: alt });
  const rows = readFileSync(alt, 'utf8').trim().split('\n').map((l) => l.split('\t'));
  assert.equal(rows.length, 1); assert.equal(rows[0][8], 'deploy-failed'); assert.match(rows[0][9], /deploy rc=/);
  assert.ok(!existsSync(join(c.env.KOTONE_OPS_DIR, 'mq-log')));
});
test('mq-runlog: `mq.sh log` prints the lines and a summary (count, median wait, median check, failure rate); --since filters', () => {
  const c = setup(); mkdirSync(c.env.KOTONE_OPS_DIR, { recursive: true }); const lg = join(c.env.KOTONE_OPS_DIR, 'mq-log');
  const L = (fin, pr, wait, chk, res) => [fin, pr, 't', 'a', '-', '-', wait, chk, res, '-', '-', '1', '-', 'no', '-', '-'].join('\t');
  writeFileSync(lg, [L('2026-11-01T10:00:00+00:00', 1, 10, 100, 'merged'), L('2026-11-21T10:00:00+00:00', 2, 30, 200, 'merged'), L('2026-11-22T10:00:00+00:00', 3, 50, 300, 'check-failed'), L('2026-11-22T11:00:00+00:00', 4, 5, '-', 'transient')].join('\n') + '\n');
  const r = c.mq('log'); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /summary: 4 entries \(2 merged, 1 failed, 1 retried\), median wait 20s, median check 200s, failure rate 33% \(1 of 3\)/);
  const r2 = c.mq('log', '--since', '2026-11-21'); assert.match(r2.stdout, /summary: 3 entries since 2026-11-21 \(1 merged, 1 failed, 1 retried\), median wait 30s, median check 250s/);
  assert.doesNotMatch(r2.stdout, /2026-11-01/);
  assert.match(c.mq('log', '--since', 'not a date').stdout, /cannot read the date/);
  assert.match(setup().mq('log').stdout, /run log empty/);
});

// ---- priority ----
test('mq-runlog priority: an entry added behind three normal ones runs next; priority entries are FIFO; list shows it', () => {
  const c = real(setup()); c.queue([['p1', 601], ['p2', 602], ['p3', 603]]);
  c.ready('p4'); c.ready('p5'); c.heads += ',604=task/p4,605=task/p5';
  assert.equal(c.mq('add', '604', 'p4', 'a', 'no', '--priority').status, 0);
  assert.deepEqual(order(c), ['604', '601', '602', '603']);
  const e = sh(c.repo, 'scripts/ops/mq.sh add 605 p5 a no', { ...c.env, KOTONE_MQ_PRIORITY: '1' }); assert.equal(e.status, 0, e.stdout + e.stderr);
  assert.deepEqual(order(c), ['604', '605', '601', '602', '603'], 'FIFO among priority entries');
  assert.match(c.mq('list').stdout, /PR 604 .*\| PRIORITY/); assert.doesNotMatch(c.mq('list').stdout, /PR 601 .*PRIORITY/);
  const r = c.go(1); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual([...r.stdout.matchAll(/^== PR (\d+)/gm)].map((m) => m[1]), ['604', '605', '601', '602', '603']);
});
test('mq-runlog priority: never goes ahead of an entry the runner already holds (merging)', () => {
  const c = real(setup()); c.queue([['q1', 611], ['q2', 612]]); c.ready('q3'); c.heads += ',613=task/q3';
  const cf = c.claimFile('q1'); writeFileSync(cf, readFileSync(cf, 'utf8').replace('state: queued', 'state: merging'));
  assert.equal(c.mq('add', '613', 'q3', 'a', 'no', '--priority').status, 0);
  assert.deepEqual(order(c), ['611', '613', '612']);
});
test('mq-runlog priority: without the flag nothing changes (plain add stays last)', () => {
  const c = real(setup()); c.queue([['q4', 621], ['q5', 622]]);
  assert.deepEqual(order(c), ['621', '622']); assert.doesNotMatch(c.mq('list').stdout, /PRIORITY/);
});

// ---- fast stamp ----
test('mq-runlog fast stamp: default off adds without a stamp; REQUIRE_FAST_STAMP=1 refuses naming the command, accepts with the stamp', () => {
  const c = setup(); c.ready('s1'); const sha = 'a'.repeat(40);
  const base = { ...c.env, KOTONE_FAKE_REVIEW_HEAD: sha };
  const on = { ...base, KOTONE_MQ_REQUIRE_FAST_STAMP: '1' };
  const r = sh(c.repo, 'scripts/ops/mq.sh add 9 s1 a no', on);
  assert.notEqual(r.status, 0); assert.match(r.stdout, /REFUSED: no fast-check stamp for the head of PR 9/); assert.match(r.stdout, /scripts\/check\.sh --fast/); assert.match(r.stdout, new RegExp(`fast-ok-${sha}`));
  assert.equal(c.state('s1'), 'started'); assert.deepEqual(order(c), []);
  writeFileSync(join(c.env.KOTONE_OPS_DIR, `fast-ok-${'b'.repeat(40)}`), '');   // a stamp for another commit does not count
  assert.notEqual(sh(c.repo, 'scripts/ops/mq.sh add 9 s1 a no', on).status, 0);
  writeFileSync(join(c.env.KOTONE_OPS_DIR, `fast-ok-${sha}`), '');
  const ok = sh(c.repo, 'scripts/ops/mq.sh add 9 s1 a no', on); assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.equal(c.state('s1'), 'queued');
  const c2 = setup(); c2.ready('s2');   // default: off
  assert.equal(sh(c2.repo, 'scripts/ops/mq.sh add 9 s2 a no', { ...c2.env, KOTONE_FAKE_REVIEW_HEAD: sha }).status, 0);
});
test('mq-runlog fast stamp: project.conf sets it; fails closed when gh returns no head', () => {
  const c = setup(); c.ready('s3');
  writeFileSync(join(c.repo, 'ops/project.conf'), `KOTONE_SLUG="${SLUG}"\nKOTONE_MQ_REQUIRE_FAST_STAMP="\${KOTONE_MQ_REQUIRE_FAST_STAMP:-1}"\n`);
  const r = sh(c.repo, 'scripts/ops/mq.sh add 9 s3 a no', { ...c.env, KOTONE_FAKE_REVIEW_HEAD: 'c'.repeat(40) });
  assert.notEqual(r.status, 0); assert.match(r.stdout, /no fast-check stamp/);
  const r2 = sh(c.repo, 'scripts/ops/mq.sh add 9 s3 a no', { ...c.env, KOTONE_FAKE_REVIEW_HEAD: '' });
  assert.notEqual(r2.status, 0); assert.match(r2.stdout, /did not return a 40-char head/);
});

// ---- fix-up rule ----
const GLOBS = { KOTONE_MQ_FIXUP_TEST_GLOBS: 'tests/**', KOTONE_MQ_FIXUP_DOC_GLOBS: 'docs/** *.md' };
const lines = (n, tag) => Array.from({ length: n }, (_, i) => `${tag}${i}`).join('\n') + '\n';
// a reviewed PR whose diff holds src/a.py, tests/t.py, docs/d.md and README.md; returns helpers to push follow-up commits
function fixupCase() {
  const c = real(setup()); c.ready('fx'); const wt = join(c.env.KOTONE_WORKTREES, `${SLUG}-fx`);
  const put = (files) => { for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(wt, p)), { recursive: true }); writeFileSync(join(wt, p), body); } };
  put({ 'src/a.py': 'a\n', 'tests/t.py': 't\n', 'docs/d.md': 'd\n', 'README.md': 'r\n' }); git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'pr'); git(wt, 'push', '-q', 'origin', 'task/fx');
  const fx = { c, wt, rv: originHead(c, 'fx'), comments: join(c.T, 'comments-fx') };
  fx.push = (files) => { put(files); git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'fix-up'); git(wt, 'push', '-q', 'origin', 'task/fx'); return originHead(c, 'fx'); };
  fx.add = (head, extra = GLOBS, base = fx.rv) => {
    writeFileSync(fx.comments, JSON.stringify(`reviewed ${base}`) + '\n');
    return sh(c.repo, 'scripts/ops/mq.sh add 9 fx a no', { ...c.env, KOTONE_MQ_REQUIRE_REVIEW: '1', KOTONE_FAKE_COMMENTS: fx.comments, KOTONE_FAKE_REVIEW_HEAD: head, ...extra });
  };
  return fx;
}
test('mq-runlog fix-up: a test-only follow-up inside the glob and line cap keeps the review; log + list record the files; the PR merges', () => {
  const fx = fixupCase(); const head = fx.push({ 'tests/t.py': 't\nmore\n' });
  const r = fx.add(head); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /kept by fix-up rule: tests\/t\.py/);
  assert.equal(fx.c.state('fx'), 'queued'); assert.match(fx.c.mq('list').stdout, /fix-up: tests\/t\.py/);
  fx.c.heads = '9=task/fx';
  const run = fx.c.go(1, { ...GATE_ON, ...GLOBS }); assert.equal(run.status, 0, run.stdout + run.stderr); assert.equal(fx.c.merges().length, 1);
  const [row] = runlog(fx.c); assert.equal(row[8], 'merged'); assert.equal(row[15], 'review kept by fix-up rule: tests/t.py');
});
test('mq-runlog fix-up: a docs follow-up (docs glob, *.md) is kept too, several files listed', () => {
  const fx = fixupCase(); const head = fx.push({ 'docs/d.md': 'd\nmore\n', 'README.md': 'r\nmore\n' });
  const r = fx.add(head); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /kept by fix-up rule: (docs\/d\.md,README\.md|README\.md,docs\/d\.md)/);
});
test('mq-runlog fix-up: touching one non-test file is refused (claim stays started)', () => {
  const fx = fixupCase(); const head = fx.push({ 'tests/t.py': 't\nmore\n', 'src/a.py': 'a\nmore\n' });
  const r = fx.add(head); assert.notEqual(r.status, 0); assert.match(r.stdout, /REFUSED: PR 9 has no review for its current head/);
  assert.match(r.stdout, /src\/a\.py matches no fix-up test or doc glob/); assert.equal(fx.c.state('fx'), 'started');
});
test('mq-runlog fix-up: over the line cap is refused; a project can raise the cap', () => {
  const fx = fixupCase(); const head = fx.push({ 'tests/t.py': lines(41, 'x') });   // 41 added + 1 deleted = 42 lines
  const r = fx.add(head); assert.notEqual(r.status, 0); assert.match(r.stdout, /42 changed lines exceed the cap of 40/);
  assert.equal(fx.add(head, { ...GLOBS, KOTONE_MQ_FIXUP_MAX_LINES: '42' }).status, 0);
});
test('mq-runlog fix-up: a head that does not descend from the reviewed commit is refused', () => {
  const fx = fixupCase(); git(fx.wt, 'reset', '-q', '--hard', 'HEAD~1'); mkdirSync(join(fx.wt, 'tests'), { recursive: true });
  writeFileSync(join(fx.wt, 'tests/t.py'), 'other\n'); git(fx.wt, 'add', '.'); git(fx.wt, 'commit', '-qm', 'rewritten'); git(fx.wt, 'push', '-q', '--force', 'origin', 'task/fx');
  const head = originHead(fx.c, 'fx'); assert.notEqual(head, fx.rv);
  const r = fx.add(head); assert.notEqual(r.status, 0); assert.match(r.stdout, /not an ancestor of the head|not available locally/); assert.equal(fx.c.state('fx'), 'started');
});
test('mq-runlog fix-up: a new file (not in the reviewed diff) or a deleted test file is refused', () => {
  const fx = fixupCase(); const head = fx.push({ 'tests/new.py': 'n\n' });
  const r = fx.add(head); assert.notEqual(r.status, 0); assert.match(r.stdout, /tests\/new\.py is not a plain modification/);
  const fy = fixupCase(); git(fy.wt, 'rm', '-q', 'tests/t.py'); git(fy.wt, 'commit', '-qm', 'rm'); git(fy.wt, 'push', '-q', 'origin', 'task/fx');
  const r2 = fy.add(originHead(fy.c, 'fx')); assert.notEqual(r2.status, 0); assert.match(r2.stdout, /not a plain modification/);
});
test('mq-runlog fix-up: a test file that was not in the reviewed diff is refused even though it matches the glob', () => {
  const fx = fixupCase(); const wt = fx.wt;
  // tests/other.py exists on main (so editing it is a plain modification) but is not part of the PR diff
  const t = join(fx.c.T, 'main-edit'); git(fx.c.T, 'clone', '-q', fx.c.origin, t); git(t, 'checkout', '-q', 'main'); mkdirSync(join(t, 'tests'), { recursive: true });
  writeFileSync(join(t, 'tests/other.py'), 'o\n'); git(t, 'add', '.'); git(t, 'commit', '-qm', 'other'); git(t, 'push', '-q', 'origin', 'main');
  git(wt, 'fetch', '-q', 'origin'); git(wt, 'merge', '-q', '--no-edit', 'origin/main'); git(wt, 'push', '-q', 'origin', 'task/fx');
  fx.rv = originHead(fx.c, 'fx');
  const head = fx.push({ 'tests/other.py': 'o\nchanged\n' });
  const r = fx.add(head); assert.notEqual(r.status, 0); assert.match(r.stdout, /tests\/other\.py was not part of the reviewed diff/);
});
test('mq-runlog fix-up: off by default (no globs) even for a test-only follow-up; refusal text is the old one', () => {
  const fx = fixupCase(); const head = fx.push({ 'tests/t.py': 't\nmore\n' });
  const r = fx.add(head, {}); assert.notEqual(r.status, 0); assert.match(r.stdout, /REFUSED: PR 9 has no review for its current head/); assert.doesNotMatch(r.stdout, /fix-up rule/);
});
test('mq-runlog fix-up at run: a test-only commit pushed after the add keeps the review; a source commit pushed after the add is refused', () => {
  const ok = fixupCase(); assert.equal(ok.add(ok.rv).status, 0); ok.push({ 'tests/t.py': 't\nlater\n' }); ok.c.heads = '9=task/fx';
  const r = ok.c.go(1, { ...GATE_ON, ...GLOBS }); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(ok.c.merges().length, 1);
  assert.match(runlog(ok.c)[0][15], /^review kept by fix-up rule: tests\/t\.py$/);
  const bad = fixupCase(); assert.equal(bad.add(bad.rv).status, 0); bad.push({ 'src/a.py': 'a\nlater\n' }); bad.c.heads = '9=task/fx';
  const r2 = bad.c.go(1, { ...GATE_ON, ...GLOBS }); assert.match(r2.stdout, /new commits after it was queued/); assert.match(r2.stdout, /fix-up rule did not apply: src\/a\.py matches no fix-up/);
  assert.equal(bad.c.merges().length, 0); assert.equal(bad.c.state('fx'), 'failed'); assert.equal(runlog(bad.c)[0][8], 'review-stale');
});
test('mq-runlog fix-up at run: the cap counts from the originally reviewed commit, not from the last fix-up', () => {
  const fx = fixupCase(); const h1 = fx.push({ 'tests/t.py': lines(30, 'x') });
  assert.equal(fx.add(h1).status, 0);                                   // 31 lines vs rv: kept
  fx.push({ 'tests/t.py': lines(30, 'y') }); fx.push({ 'tests/t.py': lines(50, 'z') }); fx.c.heads = '9=task/fx';
  const r = fx.c.go(1, { ...GATE_ON, ...GLOBS }); assert.match(r.stdout, /51 changed lines exceed the cap of 40/); assert.equal(fx.c.merges().length, 0);
});

// ---- k8-harden: worktree lock, fix-up edge cases, test isolation -------------------------------------------------
const wtList = (c) => git(c.repo, 'worktree', 'list', '--porcelain');
test('k8 worktree lock: start locks the worktree; a bare `git worktree prune` keeps it even while its folder is moved away', () => {
  const c = setup(); const wt = c.ready('k1');
  assert.match(wtList(c), new RegExp(`worktree ${wt}\\n[^\\n]*\\n[^\\n]*\\nlocked task k1`));
  const away = `${wt}.away`; sh(c.repo, `mv ${JSON.stringify(wt)} ${JSON.stringify(away)}`);
  git(c.repo, 'worktree', 'prune');
  assert.match(wtList(c), new RegExp(`worktree ${wt}\\b`), 'entry survived prune');
  sh(c.repo, `mv ${JSON.stringify(away)} ${JSON.stringify(wt)}`);
  assert.equal(git(wt, 'rev-parse', '--abbrev-ref', 'HEAD').trim(), 'task/k1', 'the worktree still works after the round trip');
});
test('k8 worktree lock: `git worktree remove` without force refuses a started task; release still removes it (unlocks first)', () => {
  const c = setup(); const wt = c.ready('k2');
  const r = sh(c.repo, `git worktree remove ${JSON.stringify(wt)}`, c.env); assert.notEqual(r.status, 0); assert.match(r.stderr, /locked/);
  const r2 = sh(c.repo, `git worktree remove --force ${JSON.stringify(wt)}`, c.env); assert.notEqual(r2.status, 0, 'a single --force does not override the lock');
  assert.ok(existsSync(wt));
  const rel = c.task('release', 'k2'); assert.equal(rel.status, 0, rel.stdout + rel.stderr); assert.ok(!existsSync(wt)); assert.doesNotMatch(wtList(c), /k2/);
});
test('k8 worktree lock: release tolerates an already-unlocked worktree', () => {
  const c = setup(); const wt = c.ready('k3'); git(c.repo, 'worktree', 'unlock', wt);
  const rel = c.task('release', 'k3'); assert.equal(rel.status, 0, rel.stdout + rel.stderr); assert.ok(!existsSync(wt));
});
test('k8 worktree lock: start on an already locked worktree is fine (idempotent)', () => {
  const c = setup(); c.ready('k4'); const again = c.task('start', 'k4'); assert.equal(again.status, 0); assert.match(wtList(c), /locked task k4/);
});
test('k8 worktree lock: release with the folder gone succeeds and drops only its own entry, another locked task keeps its worktree', () => {
  const c = setup(); const w5 = c.ready('k5'); const w6 = c.ready('k6');
  sh(c.repo, `rm -rf ${JSON.stringify(w5)}`);
  const rel = c.task('release', 'k5'); assert.equal(rel.status, 0, rel.stdout + rel.stderr); assert.doesNotMatch(rel.stdout + rel.stderr, /could not remove/);
  assert.doesNotMatch(wtList(c), /k5/); assert.match(wtList(c), new RegExp(`worktree ${w6}`)); assert.ok(existsSync(w6));
  assert.ok(!existsSync(c.claimFile('k5')));
});
test('k8 worktree lock: a worktree whose folder is gone is still protected from prune until release (verify reports MISSING)', () => {
  const c = setup(); const wt = c.ready('k7'); sh(c.repo, `rm -rf ${JSON.stringify(wt)}`);
  git(c.repo, 'worktree', 'prune'); assert.match(wtList(c), /k7/);
  assert.match(c.task('verify', 'k7').stdout, /MISSING: task k7/);
});

// fix-up: mode change and rename are not "plain modifications"
test('k8 fix-up: a mode-only change to a test file is refused', () => {
  const fx = fixupCase(); git(fx.wt, 'update-index', '--chmod=+x', 'tests/t.py'); git(fx.wt, 'commit', '-qm', 'chmod'); git(fx.wt, 'push', '-q', 'origin', 'task/fx');
  const r = fx.add(originHead(fx.c, 'fx')); assert.notEqual(r.status, 0); assert.match(r.stdout, /tests\/t\.py is not a plain modification \(status M, mode 100644->100755\)/);
});
test('k8 fix-up: renaming a test file is refused', () => {
  const fx = fixupCase(); git(fx.wt, 'mv', 'tests/t.py', 'tests/t2.py'); git(fx.wt, 'commit', '-qm', 'rename'); git(fx.wt, 'push', '-q', 'origin', 'task/fx');
  const r = fx.add(originHead(fx.c, 'fx')); assert.notEqual(r.status, 0); assert.match(r.stdout, /not a plain modification/);
});

// check.sh --fast stamp (template check.sh, run in a tiny fake project that has no real tools)
test('k8 check --fast: writes fast-ok-<HEAD> into the ops dir on a clean tree, not on a dirty one', () => {
  const c = setup(); const wt = c.ready('k8');
  const stub = `#!/usr/bin/env bash\nexit 0\n`; mkdirSync(join(wt, 'node_modules'), { recursive: true });
  // a copy of the template check.sh whose heavy steps are replaced by no-ops: we only test the stamp block at its end
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../check.sh'), 'utf8');
  const head = src.indexOf('if [[ $FAST == 1 ]]; then'); assert.ok(head > 0, 'stamp block present');
  writeFileSync(join(wt, 'scripts/check.sh'), `#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")/.."\nFAST=0; [[ "\${1:-}" == "--fast" ]] && FAST=1\n${src.slice(head)}`);
  chmodSync(join(wt, 'scripts/check.sh'), 0o755); void stub;
  git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'stub check'); const sha = git(wt, 'rev-parse', 'HEAD').trim();
  const r = sh(wt, 'scripts/check.sh --fast', c.env); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(c.env.KOTONE_OPS_DIR, `fast-ok-${sha}`)), r.stdout);
  writeFileSync(join(wt, 'dirty.txt'), 'x');
  const dirtySha = sha; sh(c.repo, `rm -f ${JSON.stringify(join(c.env.KOTONE_OPS_DIR, `fast-ok-${dirtySha}`))}`);
  const r2 = sh(wt, 'scripts/check.sh --fast', c.env); assert.equal(r2.status, 0); assert.match(r2.stdout, /no fast-ok stamp written/);
  assert.ok(!existsSync(join(c.env.KOTONE_OPS_DIR, `fast-ok-${dirtySha}`)));
});
test('k8 fast stamp end to end: the stamp check.sh writes is the one `mq.sh add` looks for', () => {
  const c = setup(); c.ready('k9'); const sha = 'd'.repeat(40);
  writeFileSync(join(c.env.KOTONE_OPS_DIR, `fast-ok-${sha}`), '');
  const r = sh(c.repo, 'scripts/ops/mq.sh add 9 k9 a no', { ...c.env, KOTONE_MQ_REQUIRE_FAST_STAMP: '1', KOTONE_FAKE_REVIEW_HEAD: sha }); assert.equal(r.status, 0, r.stdout + r.stderr);
});

// test isolation: nothing in this file may create folders in the real default worktrees dir
test('k8 isolation: the real default worktrees dir gained no entries during this test file', () => {
  const real = '/mnt/wsl/work/worktrees';
  if (!existsSync(real)) return;
  const now = readdirSync(real).filter((n) => /^testproj-|^t-test$/.test(n));
  assert.deepEqual(now.filter((n) => !REAL_WT_BEFORE.includes(n)), [], 'tests leaked worktrees into the real worktrees dir');
});

test('k8 fast stamp location: written by check.sh in a task worktree under the COMMON git dir, found by `mq.sh add` run from the main checkout', () => {
  const c = setup(); const e = { ...c.env }; delete e.KOTONE_OPS_DIR;   // default ops dir = <common git dir>/kotone-ops, as in a real project
  const run = (cwd, cmd, extra = {}) => sh(cwd, cmd, { ...e, ...extra });
  assert.equal(run(c.repo, 'scripts/ops/task.sh claim k10 a t src/k10').status, 0);
  const st = run(c.repo, 'scripts/ops/task.sh start k10 --no-install'); assert.equal(st.status, 0, st.stdout + st.stderr);
  const wt = join(e.KOTONE_WORKTREES, `${SLUG}-k10`);
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../check.sh'), 'utf8');
  writeFileSync(join(wt, 'scripts/check.sh'), `#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")/.."\nFAST=0; [[ "\${1:-}" == "--fast" ]] && FAST=1\n${src.slice(src.indexOf('if [[ $FAST == 1 ]]; then'))}`);
  chmodSync(join(wt, 'scripts/check.sh'), 0o755); git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'stub check'); git(wt, 'push', '-q', 'origin', 'task/k10');
  const sha = git(wt, 'rev-parse', 'HEAD').trim();
  const r = run(wt, 'scripts/check.sh --fast'); assert.equal(r.status, 0, r.stdout + r.stderr);
  const common = join(c.repo, '.git', 'kotone-ops', `fast-ok-${sha}`);
  assert.ok(existsSync(common), `stamp in the common dir: ${r.stdout}`);
  assert.ok(!existsSync(join(c.repo, '.git', 'worktrees', `${SLUG}-k10`, 'kotone-ops')), 'not in the per-worktree git dir');
  const add = run(c.repo, 'scripts/ops/mq.sh add 9 k10 a no', { KOTONE_MQ_REQUIRE_FAST_STAMP: '1', KOTONE_FAKE_REVIEW_HEAD: sha });
  assert.equal(add.status, 0, add.stdout + add.stderr);
});

// ---- re-add of a PR that is already queued (mq-readd-refresh) -------------------------------------------------------
// One independent scenario per test: own throwaway repo and ops dir (setup() isolates KOTONE_OPS_DIR), fake gh, one PR.
const RD = { KOTONE_MQ_REQUIRE_REVIEW: '1', KOTONE_MQ_REQUIRE_FAST_STAMP: '1' };
function rdSetup(extra = {}) {
  const pr = 9, id = 'rd';
  const c = setup(); c.ready(id);
  const comments = join(c.T, 'comments'), qf = join(c.env.KOTONE_OPS_DIR, 'queue', `pr${pr}`);
  const stamp = (sha) => writeFileSync(join(c.env.KOTONE_OPS_DIR, `fast-ok-${sha}`), '');
  const say = (...shas) => writeFileSync(comments, shas.map((s) => JSON.stringify(`reviewed ${s}`)).join('\n') + '\n');
  const envFor = (more = {}) => ({ ...c.env, ...RD, KOTONE_FAKE_COMMENTS: comments, KOTONE_FAKE_REVIEW_HEAD: c.head, ...extra, ...more });
  const add = (a = 'no', agent = 'a', task = id) => sh(c.repo, `scripts/ops/mq.sh add ${pr} ${task} ${agent} ${a}`, envFor());
  const reviewedLine = () => (readFileSync(qf, 'utf8').match(/^reviewed: (.*)$/m) || [])[1];
  c.head = originHead(c, id); const h1 = c.head; say(h1); stamp(h1);
  const first = add(); assert.equal(first.status, 0, first.stdout + first.stderr); assert.equal(reviewedLine(), h1);
  // a new commit that the fix-up rule cannot keep (a new file), so only a fresh review counts
  let n = 0;
  const more = () => { const wt = join(c.env.KOTONE_WORKTREES, `${SLUG}-${id}`); writeFileSync(join(wt, `${id}-more-${++n}.txt`), 'more'); git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'more'); git(wt, 'push', '-q', 'origin', `task/${id}`); c.head = originHead(c, id); return c.head; };
  const qdir = join(c.env.KOTONE_OPS_DIR, 'queue');
  return Object.assign(c, { pr, id, h1, qf, qdir, say, stamp, add, more, envFor, reviewedLine, entry: () => readFileSync(qf, 'utf8'), queueFiles: () => readdirSync(qdir).sort().join(',') });
}
const short12 = (s) => s.slice(0, 12);

test('readd: a new valid review for the new head refreshes the recorded sha; position, hold, task, agent and deploy stay; the stamp is required', () => {
  const c = rdSetup(); const h2 = c.more(); c.say(c.h1, h2); const before = c.entry();
  const nostamp = c.add(); assert.notEqual(nostamp.status, 0); assert.match(nostamp.stdout, /no fast-check stamp/); assert.equal(c.entry(), before);
  c.stamp(h2); const r = c.add();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`PR 9 already queued: reviewed commit updated ${short12(c.h1)} -> ${short12(h2)}, position 1`));
  assert.equal(c.reviewedLine(), h2); assert.equal((c.entry().match(/^reviewed: /gm) || []).length, 1);
  assert.equal(c.entry().replace(/^reviewed: .*\n/m, ''), before.replace(/^reviewed: .*\n/m, ''));
  assert.equal(c.state('rd'), 'queued');
  const again = c.add(); assert.equal(again.status, 0); assert.match(again.stdout, /nothing changed/);
});
test('readd: no valid review for the new head changes nothing, exits non-zero and says what is needed', () => {
  const c = rdSetup(); const h2 = c.more(); c.say(c.h1); c.stamp(h2); const before = c.entry(), files = c.queueFiles();
  const r = c.add(); assert.notEqual(r.status, 0);
  assert.match(r.stdout, new RegExp(`recorded review \\(${short12(c.h1)}\\) is for an older head`)); assert.match(r.stdout, new RegExp(`exactly 'reviewed ${h2}'`));
  assert.equal(c.entry(), before); assert.equal(c.queueFiles(), files);
});
test('readd: a held entry stays held at the same position', () => {
  const c = rdSetup(); assert.equal(c.mq('hold', '9').status, 0); const h2 = c.more(); c.say(c.h1, h2); c.stamp(h2);
  const order0 = c.entry().match(/^order: (.*)$/m)[1]; const r = c.add();
  assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /reviewed commit updated/);
  assert.match(c.entry(), /^held: yes$/m); assert.equal(c.entry().match(/^order: (.*)$/m)[1], order0);
});
test('readd: a differing deploy flag, agent or task is refused even with a valid new review (deploy:no is the same flag as no)', () => {
  const c = rdSetup(); const h2 = c.more(); c.say(c.h1, h2); c.stamp(h2); const before = c.entry();
  for (const [args, re] of [[['yes'], /REFUSED.*deploy yes.*remove \+ add/], [['no', 'other-agent'], /REFUSED.*agent other-agent/], [['no', 'a', 'other-task'], /REFUSED.*task other-task/]]) {
    const r = c.add(...args); assert.notEqual(r.status, 0); assert.match(r.stdout, re); assert.equal(c.entry(), before);
  }
  const ok = c.add('deploy:no'); assert.equal(ok.status, 0, ok.stdout); assert.match(ok.stdout, /reviewed commit updated/);
});
test('readd: a short, truncated or upper-case sha comment is not a review', () => {
  const c = rdSetup(); const h2 = c.more(); c.stamp(h2);
  writeFileSync(join(c.T, 'comments'), [c.h1, h2.slice(0, 12), h2.slice(0, 39), h2.toUpperCase()].map((s) => JSON.stringify(`reviewed ${s}`)).join('\n') + '\n');
  const before = c.entry(), r = c.add(); assert.notEqual(r.status, 0); assert.match(r.stdout, /older head/); assert.equal(c.entry(), before);
});
test('readd: a review comment for an older head never downgrades the entry', () => {
  const c = rdSetup(); const h2 = c.more(); c.say(c.h1, h2); c.stamp(h2); assert.equal(c.add().status, 0);
  c.say(h2, c.h1); const before = c.entry(); const r = c.add();   // the old review is now the newest comment
  assert.equal(r.status, 0); assert.match(r.stdout, /nothing changed/); assert.equal(c.reviewedLine(), h2); assert.equal(c.entry(), before);
  c.say(c.h1); c.add(); assert.equal(c.reviewedLine(), h2); assert.equal(c.entry(), before);
});
test('readd: an entry the runner holds (merging) is never modified', () => {
  const c = rdSetup(); const h2 = c.more(); c.say(c.h1, h2); c.stamp(h2);
  writeFileSync(c.claimFile('rd'), readFileSync(c.claimFile('rd'), 'utf8').replace(/^state: .*$/m, 'state: merging'));
  const before = c.entry(), files = c.queueFiles(), r = c.add();
  assert.notEqual(r.status, 0); assert.match(r.stdout, /REFUSED.*merging/); assert.equal(c.entry(), before); assert.equal(c.queueFiles(), files);
});
test('readd: it takes the queue lock (waits for a holder), and parallel re-adds beside a run leave one consistent entry', async () => {
  const c = rdSetup(); const h2 = c.more(); c.say(c.h1, h2); c.stamp(h2); const before = c.entry();
  const lock = join(c.env.KOTONE_OPS_DIR, '.lock');
  const holder = spawn('bash', ['-c', `exec 9>"${lock}"; flock 9; echo held; sleep 3`], { stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((res) => holder.stdout.once('data', res));
  const p = spawn('bash', ['-c', 'scripts/ops/mq.sh add 9 rd a no'], { cwd: c.repo, env: cleanEnv(c.envFor()), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; p.stdout.on('data', (d) => { out += d; });
  const closed = new Promise((res) => p.on('close', res));
  await new Promise((res) => setTimeout(res, 1000));
  assert.equal(p.exitCode, null, 'the re-add must still be waiting for the lock'); assert.equal(c.entry(), before);
  const code = await closed;
  assert.equal(code, 0); assert.match(out, /reviewed commit updated/); assert.equal(c.reviewedLine(), h2);
  // burst: identical parallel re-adds and a dry-run queue run
  const h3 = c.more(); c.say(c.h1, h2, h3); c.stamp(h3);
  const envp = cleanEnv(c.envFor());
  const go = (cmd, extra = {}) => new Promise((res) => { let o = ''; const q = spawn('bash', ['-c', `${cmd} 2>&1`], { cwd: c.repo, env: { ...envp, ...extra } }); q.stdout.on('data', (d) => { o += d; }); q.on('close', () => res(o)); });
  const jobs = [1, 2, 3, 4, 5, 6].map(() => go('scripts/ops/mq.sh add 9 rd a no'));
  jobs.push(go('scripts/ops/mq.sh run', { KOTONE_MQ_DRYRUN: '1', KOTONE_MQ_HEAD: 'task/rd' }));
  const outs = await Promise.all(jobs);
  const files = [...readdirSync(c.qdir).map((x) => join(c.qdir, x)), c.claimFile('rd')];
  for (const f of files) {
    const t = readFileSync(f, 'utf8'); assert.ok((t.match(/^reviewed: /gm) || []).length <= 1, f); assert.ok((t.match(/^state: /gm) || []).length <= 1, f);
  }
  assert.ok(readdirSync(c.qdir).every((x) => !x.startsWith('.tmp')), 'no temp file left');
  assert.ok(outs.slice(0, 6).filter((o) => /reviewed commit updated/.test(o)).length <= 1);
  assert.ok(!outs.some((o) => /illegal|atomic_write|syntax error|unbound/.test(o)), outs.join('\n'));
});
test('readd: a kept fix-up is recorded with its base; an unreviewable head refreshes nothing', () => {
  const c = rdSetup({ KOTONE_MQ_FIXUP_DOC_GLOBS: '*.txt' });
  const wt = join(c.env.KOTONE_WORKTREES, `${SLUG}-rd`); writeFileSync(join(wt, 'rd.txt'), 'rd\ntwo\n'); git(wt, 'add', '.'); git(wt, 'commit', '-qm', 'fixup'); git(wt, 'push', '-q', 'origin', 'task/rd');
  c.head = originHead(c, 'rd'); const h2 = c.head; c.say(c.h1); c.stamp(h2);
  const r = c.add(); assert.equal(r.status, 0, r.stdout); assert.equal(c.reviewedLine(), h2); assert.match(c.entry(), new RegExp(`^review-base: ${c.h1}$`, 'm'));
  const h3 = c.more(); c.stamp(h3); const before = c.entry(); const r2 = c.add(); assert.notEqual(r2.status, 0); assert.equal(c.entry(), before);
});
