# Evaluating the Admin Tools

Onboarding guide for running the `joecon/eval` harness against the **admin tools**
(`list-users`, `list-jobs`, `query-admin-insights`, `list-extract-refresh-tasks`,
`update-user`, `delete-content`, `update-cloud-extract-refresh-task`). Some are
read-only (`list-*`, `query-admin-insights`); three are **mutations** run in preview
mode (`update-user`, `delete-content`, `update-cloud-extract-refresh-task`).

Read [`evals/README.md`](./README.md) first for the general harness. This doc only
covers what is different for the admin tools.

---

## 1. Branch reality check (read before rebasing)

The eval harness lives on **`joecon/eval`**. The mutation/admin tools live on
**`main`**. They have diverged:

| | `joecon/eval` | `origin/main` |
|---|---|---|
| package version | `2.2.5` | `3.5.5` |
| merge-base | `ee77f50e` (96 commits behind main) | — |
| eval harness (`evals/`) | ✅ present | ❌ absent |
| mutation/admin tools (`src/tools/web/users`, `_lib/deleteContent`, …) | ❌ absent | ✅ present |
| `ADMIN_TOOLS_ENABLED` gate | ❌ not in code | ✅ present |

**Consequence:** you cannot eval the mutation/admin tools on `joecon/eval` as-is —
the tools are not in the build. You must combine the two. See §5 (Rebase plan).

The 7 `joecon/eval`-only commits touch **only**: `evals/`, `docs/docs/evaluation/`,
`env.example.list`, `package.json`/`package-lock.json`, `.gitignore`,
`team_context/eval-questions.md`. No conflicts with `src/` — the rebase is clean
except for `package.json` (version + scripts) and `package-lock.json`.

---

## 2. The one required code patch (`run-case.ts`)

The admin tools are gated behind `ADMIN_TOOLS_ENABLED=true` (and `query-admin-insights`
+ friends). The eval runner spawns the MCP server as a subprocess and only forwards a
**hardcoded allowlist** of env vars — and `ADMIN_TOOLS_ENABLED` / `INSIGHTS_TOOLS_ENABLED`
are **not on it**. Without this patch the admin tools never register, and every admin
case fails with `missing_tools`.

In `evals/run-case.ts`, function `tableauServerEnv()`, add to the `keys` array:

```ts
    'ADMIN_TOOLS_ENABLED',
    'INSIGHTS_TOOLS_ENABLED',
    'FEATURE_GATE_PROVIDER_CONFIG',   // needed only for confirm-* app-only tools (mcp-apps gate)
```

`FLOW_TOOLS_ENABLED` is already forwarded; mirror it. (Same passthrough exists in
`run-suite.ts` only via `run-case.ts`, so patching `run-case.ts` covers both.)

---

## 3. Tool gating — what registers when

| Tool | Gate(s) | Model-visible? |
|---|---|---|
| `list-users`, `list-jobs`, `list-extract-refresh-tasks`, `query-admin-insights` | `ADMIN_TOOLS_ENABLED=true` | yes |
| `update-user` | `ADMIN_TOOLS_ENABLED=true` | yes (preview→confirm, same tool) |
| `update-cloud-extract-refresh-task` | `ADMIN_TOOLS_ENABLED=true` (Cloud only) | yes |
| `delete-content` | `ADMIN_TOOLS_ENABLED=true` | yes |
| `confirm-update-cloud-extract-refresh-task`, `confirm-delete-content` | `ADMIN_TOOLS_ENABLED=true` **AND** `mcp-apps` feature gate | **no** — app-only, model-invisible |

Two consequences for evals:

1. **All admin cases require a site-admin PAT.** The `adminGate` reads the caller's
   `siteRole` and rejects anything that is not `SiteAdministratorCreator`,
   `SiteAdministratorExplorer`, or `ServerAdministrator`. A viewer/explorer PAT →
   every admin tool returns "requires site administrator permissions".
2. **Do not put `confirm-*` tools in `expected_tools`.** They are model-invisible;
   the agent cannot call them, and the grader would always report them missing.

---

## 4. Mutations are two-phase — eval the PREVIEW, never the apply

`update-user`, `delete-content`, and `update-cloud-extract-refresh-task` are all
**preview → confirm**:

- **`confirm` omitted/false → PREVIEW.** Non-destructive. Looks up the target, reports
  the proposed change, returns a single-use confirmation token. **Nothing is mutated.**
- **`confirm: true` → APPLY.** Requires the token from a matching prior preview.

**Eval the preview phase only.** It exercises the full tool path (auth, admin gate,
lookup, schema, HITL token minting) with zero blast radius. The provided cases all
prompt the agent explicitly *not* to confirm.

> ⚠️ Never point an apply-phase eval at real content. If you must test apply, use a
> disposable throwaway user/workbook/task on a non-production test site, and expect the
> harness to leave it mutated.

---

## 5. Rebase plan (`joecon/eval` onto `origin/main`)

Goal: eval harness + current tools in one working tree.

```bash
cd /Users/asimantov/dev/git_repos/main/tableau-mcp
git fetch origin
git switch joecon/eval
git switch -c joecon/eval-rebased        # keep the original branch as a safety net

git rebase origin/main
# Expected conflicts: package.json (version 2.2.5 vs 3.5.5 + eval scripts),
#   package-lock.json, possibly env.example.list.
#   Resolution: KEEP main's version/deps, KEEP joecon's eval:* scripts + eval env keys.
#   For package-lock.json: take main's, then `npm install` to re-add eval deps (tsx,
#   langsmith, dotenv) and regenerate the lock.

npm install
npm run build           # must produce build/index.js with the admin tools
npm run test            # unit tests should pass on the merged tree
```

Sanity-check the tools are actually in the build:

```bash
ADMIN_TOOLS_ENABLED=true node build/index.js --help 2>/dev/null | grep -E 'update-user|delete-content|query-admin-insights'
```

Then apply the §2 `run-case.ts` patch (it may need re-applying if the rebase touched it).

---

## 6. Configure `.env`

Add to the repo-root `.env` (on top of the base config in `README.md` §Configuration):

```bash
# Admin tools gate — REQUIRED for every case in evals/cases/admin/
export ADMIN_TOOLS_ENABLED=true

# Site-admin PAT — the adminGate rejects non-admins
export AUTH=pat
export SERVER="https://<your-test-site>.online.tableau.com"
export SITE_NAME="<your-test-site>"
export PAT_NAME="<admin-pat-name>"
export PAT_VALUE="<admin-pat-secret>"

# Disposable test targets for the mutation preview cases (throwaway objects on a test site)
export EVAL_UPDATE_USER_LUID="<luid-of-a-disposable-test-user>"
export EVAL_DELETE_WORKBOOK_LUID="<luid-of-a-disposable-test-workbook>"
export EVAL_EXTRACT_TASK_LUID="<luid-of-a-disposable-extract-refresh-task>"   # Cloud only
```

Use a **dedicated test site**, not production. Even preview cases read live user/content
metadata.

---

## 7. Run the admin cases

These are **tool-coverage** cases (no gold numeric answer), so they run one-per-file via
`eval:run` and grade via `eval:grade` — **not** through the BIRD suite runner
(`eval:suite`, which is hardcoded to the `question_id` BIRD schema).

```bash
npm run build     # always rebuild after any src change

# read-only admin smoke tests first — cheapest, prove the gate + PAT work
npm run eval:run  -- evals/cases/admin/list-users.json
npm run eval:grade -- evals/runs/$(date +%F)/<run-id>          # run-id printed by eval:run

npm run eval:run  -- evals/cases/admin/query-admin-insights.json

# mutation PREVIEW cases (safe — nothing is applied)
npm run eval:run  -- evals/cases/admin/update-user-preview.json
npm run eval:run  -- evals/cases/admin/delete-content-preview.json
npm run eval:run  -- evals/cases/admin/update-extract-refresh-task-preview.json

# grade each (grade.ts sources tool coverage from the LangSmith trace)
npm run eval:grade -- evals/runs/$(date +%F)/<run-id>
```

`eval:grade` verdict for these cases = **tool coverage + budget + exit code**:
`pass` iff every tool in `expected_tools` appears in the trace, no timeout, exit 0,
and tool calls ≤ budget. (`grade-bird`'s numeric/semantic judge does **not** apply —
these cases have no gold value.)

### Provided cases (in `evals/cases/admin/`)

| Case file | Tools exercised | Mutates? |
|---|---|---|
| `list-users.json` | `list-users` | no (read) |
| `query-admin-insights.json` | `query-admin-insights` | no (read) |
| `update-user-preview.json` | `update-user` (preview) | no |
| `delete-content-preview.json` | `delete-content` (preview) | no |
| `update-extract-refresh-task-preview.json` | `list-extract-refresh-tasks`, `update-cloud-extract-refresh-task` (preview) | no |

---

## 8. Produce a report to attach to a PR

Two levels of reporting:

**Per-case JSON (attach directly):** each graded run writes
`evals/runs/<date>/<run-id>/result.json` with `outcome`, `expected_tools`,
`observed_tools`, `missing_tools`, `tool_calls`, `cost_usd`, `wall_ms`, `trace_id`.
These are the ground-truth artifacts for a PR.

**Roll-up markdown:** `npm run eval:report` aggregates every graded case into
`evals/reports/<timestamp>/summary.md` (+ `.json`/`.csv`) by (harness × model), with
accuracy/latency/cost/tool-count. Attach `summary.md` to the PR.

```bash
npm run eval:report
# or scope it:
npm run eval:report -- --since $(date +%F)
```

For a quick PR-ready table without the roll-up tool, collect the `result.json` files:

```bash
for f in evals/runs/$(date +%F)/*/result.json; do
  node -e "const r=require('./'+process.argv[1]);console.log([r.case_id,r.outcome,r.tool_calls,(r.missing_tools||[]).join('|')||'-'].join('\t'))" "$f"
done
```

Paste as a table:

| case | outcome | tool_calls | missing |
|---|---|---|---|
| list-users | PASS | 2 | - |
| … | | | |

---

## 9. Failure triage cheat-sheet

| Symptom | Cause | Fix |
|---|---|---|
| `missing_tools: [list-users]`, tool never called | `ADMIN_TOOLS_ENABLED` not forwarded to server subprocess | Apply §2 patch to `run-case.ts` |
| Tool called, returns "requires site administrator permissions" | PAT is not a site admin | Use a `SiteAdministrator*` / `ServerAdministrator` PAT |
| `grading_error`, no trace found | LangSmith plugin not installed/configured for the harness | See README §Prerequisites 2; check `TRACE_TO_LANGSMITH=true` |
| `confirm-delete-content` reported missing | model-invisible app-only tool put in `expected_tools` | Remove it — the model cannot call it |
| `update-cloud-extract-refresh-task` returns "not supported" | pointed at Tableau Server, not Cloud | Cloud-only tool; use a Cloud test site |
| Prompt references `{{env.EVAL_UPDATE_USER_LUID}}` — throws "not set" | test-target LUID env var missing | Set it in `.env` (§6) |
