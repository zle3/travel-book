# Little Travel Book — tech operations

How work moves from request to production without duplicated effort or conflicts. Generated from the kotone framework (`.kotone-version`); project-specific facts go in "Project decisions" below, everything else is framework text that `kotone-upgrade` can refresh.

## Stack
- **Site:** Astro, static output. Design system and rules: `DESIGN.md`. Product truth: `PRODUCT.md`.
- **Source:** GitHub repo `zle3/travel-book` (private). `main` is production. Work happens on `task/<id>` branches, one git worktree each.
- **Hosting:** Cloudflare **Workers static assets**. Worker `travel-book`, config `wrangler.jsonc`: `main: worker/index.ts` (password gate and bot policy, see `worker/README.md`), assets from `./dist` with `binding: ASSETS` and `run_worker_first: true`, `not_found_handling: 404-page`. **Direct upload** with `wrangler` from the merge queue. No Cloudflare Git integration, so the bytes that passed the local check are exactly the bytes that ship.
  - Live address: **https://travel.zachle.info** (custom domain route in `wrangler.jsonc`; `workers_dev` is off). The Worker and the domain's zone must be in the **same Cloudflare account**.
  - `public/robots.txt` matches what the Worker serves for `/robots.txt` (a gate test checks this). It disallows every crawler and has no Sitemap line.
  - Search indexing is OFF by default: `GATE_ALLOW_SEARCH` is `"0"` in `wrangler.jsonc` (and the code default when unset), and every Worker response carries `X-Robots-Tag: noindex`. Do not turn indexing on without an owner decision.
  - Password gate: **permanent by default**. Do not add tasks to turn it off at launch; `GATE_DISABLED=1` removes the gate and is an owner-only decision. Owner how-to (set, change, sign out): `docs/PASSWORD.md`.
  - Link previews: the gate page's title, description, credit and preview image come from `worker/site-config.ts`; the 1200x630 `public/assets/preview-card.png` is on the exact-match public allow-list.
- **CI:** all local (`scripts/check.sh`). GitHub Actions is never used (zero runner minutes). A pre-push hook runs the fast check and blocks direct pushes to `main`.
- **Backend:** none until an architect-level decision says otherwise.

## Project decisions (fill in; owner decisions with dates)
- Mode: new. Original site (rebuild mode only): ``, captured into `_source/` (empty for a new site).
- Fill in: gate policy, indexing policy, what the owner has approved to launch, any placeholder-deploy approvals.

## Team
| Area | First tier (Haiku) | Escalation (Sonnet) | Top (Opus) |
|---|---|---|---|
| Web: copy, pages, data | `kotone-content` | `kotone-senior-web` | `kotone-architect` |
| Web: design system, components, layout | `kotone-ui` | `kotone-senior-web` | `kotone-architect` |
| Web: interactive features | `kotone-feature` | `kotone-senior-web` | `kotone-architect` |
| DevOps: tests, hooks, build, deploy config | `kotone-devops` | `kotone-senior-ops` | `kotone-architect` |
| SysAdmin: GitHub, Cloudflare, deps, secrets | `kotone-sysadmin` | `kotone-senior-ops` | `kotone-architect` |
| Merging + production deploys | — | `kotone-merge-queue` (only merger) | — |
| Review and audit (read-only, never edits or merges) | `kotone-reviewer` | — | — |

The `kotone-*` agents are **global and project-neutral** (installed in `~/.claude/agents/` by the framework's `kotone-install`). They carry no project knowledge of their own. For everything project-specific they read this file, `DESIGN.md` and `PRODUCT.md`, plus the task's claim and worktree.

The **lead** (the main Claude session) triages requests, claims tasks, dispatches agents, routes escalations and reports to the owner. The lead does not write feature code when an agent fits.

## Lifecycle of a task
1. **Triage (lead).** Search first: `scripts/ops/task.sh list`, `gh pr list`, `git log`. If it's already done or in flight, don't start it again.
2. **Claim (lead).** `scripts/ops/task.sh claim <id> <agent> "<title>" <paths…>`. Paths are prefix-matched; a claim that overlaps an open task is refused, so two agents can never edit the same files. Then `scripts/ops/task.sh start <id>` creates the worktree and branch (`start` also fetches `origin/main`).
   - **One PR per task, branched from `origin/main` via `task.sh start`.** Never stack a PR on another task's branch and never merge another task's branch into yours. If B needs A, wait for A to merge, then merge `origin/main` into B. (Safety net only: if a queued PR turns out to be already contained in main, because GitHub says MERGED, its head is an ancestor of `origin/main`, or every commit has a patch-equivalent there, `mq.sh run` skips check and merge, marks the task merged "already contained in main", releases it and closes the PR with a comment if still open.)
   - Task ids: short kebab slugs with a number, e.g. `t012-contact-copy`.
   - **Need more paths?** An agent that reports `NEED-PATHS: <paths>` gets them with `scripts/ops/task.sh grant <id> <path>…`. Same overlap check; each grant is recorded with who and when in the claim file.
   - **Re-claiming a released id** works only when branch `task/<id>` is already merged into main. If the branch has commits not in main, the claim is refused: pick a new id, or finish or merge that branch first.
3. **Dispatch (lead).** Start the first-tier agent with: task id, worktree path, the claimed paths, what "done" means, and anything already ruled out.
4. **Build (agent).** Work only in the worktree on claimed paths; `scripts/check.sh --fast`; push; open PR; `scripts/ops/mq.sh add <pr> <id> <agent> yes|no`. `mq.sh add` needs the claim to be `started` (a task that is already queued, merging or released is refused) and, by default, a review on the PR's current head (see "Review gate" below).
5. **Escalate (agent → lead → higher tier).** The agent pushes its work-in-progress and replies `ESCALATE: <agent> — reason` with Done / Left / Branch / Notes. The lead runs `scripts/ops/task.sh handoff <id> <higher-agent> "<reason>"` and dispatches the higher tier on the **same** branch and worktree with the handoff notes. Nothing is redone.
6. **Merge (merge queue).** The lead starts `kotone-merge-queue` when the queue is non-empty. It runs `scripts/ops/mq.sh run`: one PR at a time, merges main in, full `scripts/check.sh`, `gh pr merge --match-head-commit`, production deploy if requested, then releases the claim and removes the worktree.
   - **node_modules on start.** `task.sh start` prepares `node_modules` from a per-lockfile cache in `<worktrees>/.node-cache/`: a copy takes about 2 seconds on a hit, and a miss runs `npm ci`. `--no-install` skips it. The cache keeps the last 3 lockfile keys; older entries are safe to delete.
   - **Always run `mq.sh run` from the main checkout**, never from inside a task worktree. A runner once started inside a task worktree deleted its own worktree. The scripts resolve paths from their own location and the release step runs from the main checkout, and the release never removes the runner's own worktree, but the rule stands.
   - `run` waits for GitHub's mergeability to settle before merging, and exits 1 if any claim could not be released. Fix it with `scripts/ops/task.sh release <id> --force`, then re-run.
7. **Queue control (lead).** `scripts/ops/mq.sh list` shows the queue in order; held entries are listed separately under `-- held (skipped by run) --`.
   - `mq.sh hold <pr>` parks an entry (it keeps its position); `mq.sh unhold <pr>` puts it back where it was.
   - `mq.sh move <pr> <position>` moves an entry to position N, numbers as shown by `list`.
   - `mq.sh remove <pr>` dequeues the entry; its claim goes back to `started` so the agent can keep working. Refused while the entry is `merging`.
8. **Report (lead).** Tell the owner what shipped, with the PR and deploy result.

### Task states
Claim state lives in the claim file (`state:` line). Only one function changes it, and every change is appended to the file as a `state-log:` line.

```
claimed  -> started                       start the worktree
started  -> queued                        mq.sh add
queued   -> started                       mq.sh remove (dequeue)
queued   -> merging                       runner picks the entry
merging  -> queued                        transient merge failure, retry
merging  -> merged | failed               check/merge outcome
merged   -> released                      release (automatic)
failed   -> queued | started | released   fix and re-queue, or give up
claimed  -> released                      drop a claim before it starts
```

- `claimed`: paths reserved, no worktree yet. `started`: worktree and branch `task/<id>` exist. `queued`: PR in the queue. `merging`: the runner has the entry; it is set before any work so a crash leaves a visible entry. `merged`: GitHub merged it; the claim is released right after. `failed`: a check, conflict or merge failed; the PR stays open.
- **Release** (`scripts/ops/task.sh release <id> [note]`) is refused while the task is `queued` or `merging`. Dequeue it first with `mq.sh remove <pr>`, or let the runner finish.
- A release with an unmerged worktree stops and says so. Commit or discard the changes, or use `release <id> --force` to remove the worktree anyway. Use `--force` only when the changes are known to be disposable.
- Claims written before the state machine have no `state:` line and read as `legacy`.

## Escalation triggers (all agents)
Escalate rather than guess when the work needs paths outside the claim, touches shared foundations, failed the same check twice, needs a design/architecture decision or new dependency, changes behaviour users rely on, or exceeds ~300 lines / ~5 files.

## Local checks
| Command | What | Who |
|---|---|---|
| `scripts/check.sh --fast` | install if needed, `astro check`, design lint, unit + gate tests, ops lifecycle tests, build | authors, pre-push hook |
| `scripts/check.sh` | the above + internal link check + browser smoke on every route + races | merge queue only |

The ops lifecycle tests (`scripts/test/ops-lifecycle.test.mjs`) build a throwaway repo with a copy of `scripts/ops` and a fake `gh`, so they never touch real claims or the real queue.

**Acceptance rule for fixes.** A regression or race test is only accepted when it was shown failing on the pre-fix code and passing on the branch. Use one independent scenario per bug, so each failure has one cause. The ops test can run against another version of the scripts with `KOTONE_OPS_SRC=<dir>`.

Browser smoke uses Playwright with any Chromium already in `~/.cache/ms-playwright` (`PW_CHROMIUM=/path` to override, or `npx playwright install chromium` once).

Test-isolation overrides (see the script headers): `KOTONE_OPS_DIR` (claims/queue state), `KOTONE_WORKTREES` (every test run that calls `task.sh start` must set it: `start` ignores `KOTONE_PROJECTS_DIR`, so without it the worktree lands in the real worktrees directory), `KOTONE_NODE_CACHE`, and the `KOTONE_MQ_*` hooks of `mq.sh`. Never test queue or claim changes against the real queue or real PRs.

## Framework files and upgrades
Files copied from the framework are listed in the framework's `managed-files.txt` (scripts/ops, scripts/check.sh, scripts/test, scripts/deploy.sh, .githooks, worker logic). `.kotone-version` records the framework commit this project last synced to. `kotone-upgrade` (run in this project) shows the diff against the framework's current version and applies nothing without flags; `kotone-upgrade --branch <id>` puts the update on a task branch for the merge queue. Project-owned files (`CLAUDE.md`, `DESIGN.md`, `PRODUCT.md`, this file, `ops/project.conf`, `ops/lint-design.json`, `worker/site-config.ts`, `wrangler.jsonc`, `src/`, `public/`) are never overwritten.

## Hooks (optional)
A project may ship executable `ops/hooks/start` and `ops/hooks/release` (looked up in the main checkout, then the worktree). `task.sh start` runs `ops/hooks/start <id> <worktree>` once, after the worktree and branch exist (cwd = worktree), e.g. to prepare a build dir or cache. `task.sh release` (including the merge queue's auto-release) runs `ops/hooks/release <id> <worktree>` just before the worktree is removed, e.g. to free a build slot; it is skipped when the worktree is kept. Env: `KOTONE_TASK_ID`, `KOTONE_WORKTREE`, `KOTONE_OPS_DIR`. Hooks are best-effort: an absent hook does nothing, a failing hook prints a WARNING and never changes the exit code or blocks start/release.

### Worktree safety
`task.sh release` is the only thing that may remove a task worktree. Agents never run `git worktree remove`, `rm -rf` on a worktree, `git worktree prune` sweeps, or generic "delete merged branches/worktrees" cleanups: a worktree can look merged or idle while a task still owns it. `release` goes through `remove_worktree`, which refuses unless the claim exists, records exactly that path and its state allows release; every removal and every refusal is logged (time, task, path, caller, agent, parent processes, result) to `<ops dir>/worktree-removals.log`. `task.sh start` also locks the worktree (`git worktree lock --reason "task <id>"`), so a `git worktree prune` or a plain `git worktree remove` by anyone else cannot take a live task's worktree, even while its folder is briefly missing; `release` unlocks first, and if the folder is already gone it drops only that task's own entry. `task.sh start` writes a git-ignored `<worktree>/.kotone-task` marker with the task id and records `worktree-created:` in the claim. If a worktree vanishes anyway, `task.sh verify [<id>]` (and `list`) reports MISSING with the fix: `git worktree add -f -f <path> task/<id>` (two `-f`: the entry is locked); then check the removals log to see whether it was one of ours.

### Merge-queue hooks, batching and the review gate
All of this lives in `scripts/ops/mq.sh`; the settings are in `ops/project.conf`.
- **Review gate (`KOTONE_MQ_REQUIRE_REVIEW`, default 1).** `mq.sh add` refuses a PR unless it has a comment whose body is exactly `reviewed <sha>`, where `<sha>` is the PR's current 40-character head commit. The reviewer posts it after a pass; any later push makes it stale and the author must get a fresh pass. If GitHub cannot be read the add is refused. `0` turns the gate off for the project; the lead can waive one PR with `KOTONE_MQ_REVIEW_WAIVE=<pr> scripts/ops/mq.sh add ...` (a WARNING is printed). `add` records the reviewed sha in the queue entry and `run` re-verifies it for every entry and batch member: the PR head must still be that sha, or a commit the runner itself pushed (so transient retries work). A PR that got new commits after it was queued is refused (claim `failed`) and must be re-reviewed and re-added; an entry queued while the gate was off is refused once the gate is on. To re-add after a new review, get the fresh `reviewed <full head sha>` comment (and the fast stamp, where required) and run the same `mq.sh add` again: for a PR that is already queued it only updates the recorded reviewed commit (position, hold, task, agent and deploy flag stay) and prints `reviewed commit updated <old12> -> <new12>`. With no valid review for the current head it changes nothing and exits non-zero; a different deploy flag, agent or task, or an entry that is merging, is refused (the lead does remove + add). Stderr WARNINGs announce `KOTONE_MQ_REQUIRE_REVIEW=0`, `KOTONE_MQ_REVIEW_WAIVE`, a `KOTONE_MQ_GH` override against the real queue, and hook files that are not executable.
- **`ops/hooks/mq-add`** (optional, executable, main checkout first, then the task worktree). Run by `mq.sh add` after the other checks as `mq-add <pr> <task-id>` with `KOTONE_PR`, `KOTONE_TASK_ID`, `KOTONE_WORKTREE`, `KOTONE_OPS_DIR` (cwd = the task worktree). Unlike the start/release hooks it is a gate: a non-zero exit refuses the add and its output is shown, so the claim stays `started`. It runs while the queue lock is held, so it must not call `mq.sh`. Absent = no-op.
- **`ops/hooks/mq-pre-merge`** (optional, executable, same lookup). Run by `mq.sh run` in the queue worktree after `origin/main` (single) or the PR heads (batch) were merged in, and before the full check, as `mq-pre-merge <pr>...` with `KOTONE_PR_LIST="<pr>..."`, `KOTONE_BATCH=0|1`, `KOTONE_OPS_DIR`. Use it for things that must be decided at merge time (version numbers, changelog fragments). It may change files and must commit them: it has to leave the tree clean (no uncommitted or untracked files) and may only add commits on top, otherwise the entry (or batch) is aborted. Its commits are checked and pushed with the PR head. A non-zero exit fails the entry: claim kept, PR open (in a batch the entries fall back to singles). Absent = no-op.
- **Batching (`KOTONE_MQ_BATCH`, default 1).** With 1 the queue behaves exactly as described above. With N>1, `run` takes up to N consecutive runnable entries with the same deploy flag, merges `origin/main` and then each PR head into the queue worktree in order, runs the pre-merge hook once, runs the full check once, pushes the result and merges each PR on GitHub in order with `--match-head-commit`. The batch commit that was checked is what gets pushed: the last PR's head is the checked tip (including any hook commits), the earlier PRs get the intermediate commits. A **tree-equality guard** runs after a fresh fetch before the first push and before every GitHub merge: `origin/main` must be exactly what the batch expects and merging the head into it must produce exactly the checked tree. If main moved or the trees differ, the batch stops. The same guard runs again right before every merge attempt, including retries after "Base branch was modified"; the single flow does the equivalent (main must still be the base that was merged in and checked, otherwise the entry restarts from the top: re-merge main, re-check). After the check, HEAD must be unchanged and the tree clean. Any failed batch (conflict, hook, check, push, guard, merge) falls back to processing the remaining entries as singles in order, so one bad PR fails alone and the others proceed; PRs that already merged stay merged. After a push, a PR head contains its predecessors, so a failed batch restores every pushed, unmerged PR head to its pre-batch sha (`git push --force-with-lease=<branch>:<our pushed sha>`, the only force push the scripts make); if a head cannot be restored the unmerged entries fail loudly instead of falling back to singles. Deploys: with N>1 production is deployed once per run, after the last merge, if any merged entry asked for `yes`; entries with different deploy flags are never batched together.
- **Deploy check and target (`KOTONE_MQ_DEPLOY_CHECK`, `KOTONE_MQ_DEPLOY_ARG`).** Before a production deploy the queue re-checks `origin/main`: `fast` (default) runs `scripts/check.sh --fast`, `full` runs `scripts/check.sh`, `none` skips it. `none` is fail closed: the queue records the tree it fully checked for the last merge and deploys only if `origin/main`'s tree is exactly that tree; if main moved or nothing is recorded, the deploy is refused with the reason. With `none`, if the last-checked entry of a run did not merge but earlier ones did, main's tree differs from the recorded one, so the deploy is refused (a safe failure) and must be done by hand. Use `full` or `none` when `--fast` is diff-based, since on already-merged main its diff is empty. `KOTONE_MQ_DEPLOY_ARG` (default `production`) is the first argument passed to `scripts/deploy.sh`. Set both in `ops/project.conf` or the environment (the environment wins).

## Shared state (never committed)
- **Run log (`KOTONE_MQ_LOG`, default `<ops dir>/mq-log`, i.e. `.git/kotone-ops/mq-log`).** `mq.sh run` appends one tab-separated line per processed queue entry, no header: finished time, PR, task id, agent, time added, time started, wait seconds (added to started), check seconds (the full check; for a batch the one shared check), result, a short cause for failures, batch id and batch size (`-` and 1 for a single), merged sha (the checked head that was merged with `--match-head-commit`), deploy flag, deploy seconds (with batching the run's one deploy), and a review note. Result is `merged`, `check-failed`, `review-stale`, `conflict`, `refused`, `deploy-failed`, or `transient` (a merge GitHub would not accept yet; the entry stays queued, so it is not counted as a failure). Empty fields are `-`. `mq.sh log [--since <date>]` prints the lines and a summary: count, median wait, median check, failure rate. Use it to re-measure "PR open to merged".
- **Priority (`mq.sh add ... --priority`, or env `KOTONE_MQ_PRIORITY=1`).** A priority entry goes ahead of every non-priority entry for the next slot, FIFO among priority entries. It never preempts a running check: entries the runner already holds (`merging`) keep their place. `mq.sh list` marks it `PRIORITY`; `move` still overrides positions.
- **Fast stamp at add (`KOTONE_MQ_REQUIRE_FAST_STAMP`, default 0).** With 1, `mq.sh add` refuses unless `<ops dir>/fast-ok-<PR head sha>` exists, the stamp a clean-tree `scripts/check.sh --fast` writes for the commit it ran on (the template `scripts/check.sh --fast` writes it on a clean tree; the one agreed place is the git COMMON dir, `$(git rev-parse --git-common-dir)/kotone-ops/`, visible from every worktree, never the per-worktree git dir). The refusal names the command to run. If GitHub cannot be read the add is refused.
- **Fix-up rule (`KOTONE_MQ_FIXUP_TEST_GLOBS`, `KOTONE_MQ_FIXUP_DOC_GLOBS`, `KOTONE_MQ_FIXUP_MAX_LINES`; off by default).** Normally any commit after `reviewed <sha>` needs a fresh review. When a project lists test globs and/or doc globs (space separated bash patterns, quoted in `project.conf`; `*` also matches `/`, so `tests/**` and `*.md` work), a follow-up commit keeps the review only when all of this holds: the reviewed sha is an ancestor of the new head; every file in `git diff <reviewed> <head>` is a plain modification (no added, deleted or renamed file, no mode change, no binary) of a file that was already in the PR's reviewed diff (the diff from where the reviewed commit forked from `origin/main`); every such file matches a test glob or a doc glob (list only documentation files in the doc globs); and the diff is at most `KOTONE_MQ_FIXUP_MAX_LINES` added plus deleted lines (default 40) counted from the reviewed commit, so several small fix-ups cannot add up past the cap. It applies at `add` (the comment `reviewed <older sha>` is accepted) and again at `run` for commits pushed after the add. Anything else is refused as today, with the reason printed. The kept review is recorded in the queue entry, shown in `mq.sh list` and written to the run log's review note as `review kept by fix-up rule: <files>`. Merge commits that the runner itself pushed keep counting as before.
`$(git rev-parse --git-common-dir)/kotone-ops/` holds `claims/`, `queue/`, `done/`, `logs/`, `notes/`, `mq-log` and `worktree-removals.log`, shared by every worktree. Inspect with `scripts/ops/task.sh list` and `scripts/ops/mq.sh list`.
- `claims/<id>`: `id`, `agent`, `title`, `branch`, `claimed`, `state:` (see Task states), `path:` lines (one per claimed path, prefix-matched), `worktree:` and `worktree-created:` once started, plus `grant:`, `escalated:`, `state-log:` and `released:` history lines.
- `queue/pr<N>`: `pr`, `task`, `agent`, `deploy`, `queued`, `reviewed` (plus `review-base`/`fixup` after a fix-up rule keep and `priority: yes`), `order:` (the explicit position; the filename is never used for ordering), and `held: yes` while the lead has parked it.
- `done/<id>`: the claim file after release.
- `notes/<id>.md`: an agent's checkpoint for its task (done, decisions, open items, exact next step, paths), so a fresh agent can continue from it alone. `notes/LEAD.md` is the lead's running log. The scripts create the directory.
Worktrees live in `<worktrees>/travel-book-<id>`, where `<worktrees>` is `$KOTONE_WORKTREES`, else `/mnt/wsl/work/worktrees` when that directory exists, else `../travel-book-worktrees/`. The merge queue uses the fixed worktree `travel-book-mq`.

## Secrets
`~/.config/travel-book/cloudflare.env` (chmod 600) with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Read at use, never printed or committed.
- Owner how-to for the site password gate (set, change, sign out): `docs/PASSWORD.md`.
- **Token permissions required** (owner adds these; agents cannot change the token):
  - Account → **Workers: Admin** (needed to CREATE the Worker on the first deploy). "Workers: Editor" can update an existing Worker but cannot create or delete one; without Admin the first deploy fails with `POST .../workers/scripts/<name>/assets-upload-session` 403 "No access to the specified resource".
  - Zone of `travel.zachle.info` → **Workers Routes: Write**, **DNS: Write**, **Zone: Read** (custom domain)
  Until these are present, upload and route commands fail with an authorization error.
  - `~/.config/travel-book/cloudflare.env` may be a symlink to a shared owner-managed `~/.config/kotone/cloudflare.env`; never read, print or copy its contents.
- **Owner one-time secrets** (own terminal, from the repo; never commit or paste them into chat):
  ```
  npx wrangler secret put SITE_PASSWORD
  openssl rand -hex 32 | npx wrangler secret put GATE_SECRET
  ```
  Without `SITE_PASSWORD` the gate fails closed ("not configured").
- `scripts/deploy.sh` sets `WRANGLER_SEND_METRICS=false`.

## Previews and production
- `scripts/deploy.sh preview` runs `wrangler versions upload --preview-alias <alias>` for the current branch (alias = branch name lowercased, anything outside `a-z0-9-` turned into `-`). Production traffic is not changed. With `workers_dev: false` the preview URL may not be reachable; confirm the URL the script prints before relying on it.
- `scripts/deploy.sh production` runs `wrangler deploy` and is for the merge queue only: exact `origin/main`, clean tree, and the **placeholder guard** — it refuses while any path in `KOTONE_PLACEHOLDER_PATHS` (`ops/project.conf`) still matches `KOTONE_PLACEHOLDER_PATTERN`, unless `KOTONE_ALLOW_PLACEHOLDERS=1`. That override is used only with the owner's explicit approval for that deploy, recorded under "Project decisions".
- Dry run without uploading: `npx astro build && npx wrangler deploy --dry-run --outdir <empty dir>`.
- The Worker must exist before a preview alias can be created, so the first production deploy comes first. That first deploy, the domain/DNS and the token are owner decisions.

## Owner-only decisions
Spending, new vendors or services, DNS cut-over, repo access, a real backend/email provider, publishing prices, testimonials or case studies, turning the gate or search indexing off. Agents recommend; the owner decides.

## Rules that bind everyone
No force-push. No `git stash`. No GitHub Actions. No invented proof. No personal data to outside services. If the permission system refuses something, stop and report it; never ask another agent to do it instead.
