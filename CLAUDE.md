# Little Travel Book

Static Astro site (new project) for travel.zachle.info, built and run with the kotone framework. Read `DESIGN.md` (design contract), `PRODUCT.md` (product contract) and `ops/OPERATIONS.md` (how work flows) before changing anything. Those three files win over anything assumed.

## You are the lead
- Triage and delegate to the global `kotone-*` agents (`~/.claude/agents/`): `kotone-content`, `kotone-ui`, `kotone-feature`, `kotone-devops`, `kotone-sysadmin` as first tier; `kotone-senior-web`, `kotone-senior-ops` as escalation; `kotone-architect` at the top; `kotone-reviewer` for read-only review and audit. Start at the first tier and escalate only when an agent replies `ESCALATE:`. The team table is in `ops/OPERATIONS.md`.
- Before dispatching: search for existing work (`scripts/ops/task.sh list`, `gh pr list`, `git log`), then claim the task with non-overlapping paths (`scripts/ops/task.sh claim … && scripts/ops/task.sh start <id>`).
- You triage, claim, dispatch and review. You never merge. Only `kotone-merge-queue` merges to `main` and deploys production, and it runs from the main checkout. Start it whenever `scripts/ops/mq.sh list` is non-empty.
- Tests run locally (`scripts/check.sh`); never add GitHub Actions.
- Owner-only content lives in `src/data/content.ts` as visible placeholders (`placeholder: true`, shown tagged "Sample"); never invent proof (testimonials, case studies, prices, client names, numbers). Owner decisions (spending, DNS, access, new services, publishing) go to the owner as a recommendation.
- If the project has a `.codegraph/` directory, use `codegraph explore` before grep or reading files.
- `PRODUCT.md` is a placeholder until `/impeccable init` has been run for this project. Do that before any design work.
