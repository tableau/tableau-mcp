# Tableau MCP Eval Harness

This folder contains a local eval harness that runs a **coding agent** (Claude Code,
Cursor, or Codex) against the Tableau MCP server, traces the run to LangSmith via the
official coding-agent tracing plugin for that agent, and grades responses against
known-correct answers — sourcing every metric from the LangSmith trace.

## How It Works

```
suite file (bird-california-schools.json)
  → run-suite.ts
    → run-case.ts (one per question)
      → AgentAdapter (claude-code | cursor | codex) builds the CLI invocation
        → claude / cursor-agent / codex exec  ── with MCP config for the tableau server
          → tableau-mcp stdio server → real Tableau Cloud/Server APIs
          → LangSmith coding-agent plugin posts the full trace
            (stamped with eval_run_id + suite_run_id + harness + model metadata)
      → run.json  (run metadata + eval_run_id correlation)
      → agent-output.jsonl  (raw agent stream — debugging only, never a grading input)
  → grade-suite.ts → grade-bird.ts (one per run)
      → fetch trace from LangSmith by eval_run_id  ← single source of truth
      → derive signals + latency/cost/token/tool metrics
      → semantic judge runs headless via GRADER_HARNESS
      → grades/YYYY-MM-DD/<run-id>/bird-result.json
  → report.ts → longitudinal quality report across cohorts (harness × model)
```

The coding agent is the eval runtime — not a simulated agent. Every tool call goes to
the real Tableau APIs. Tracing and all grading signals come from the LangSmith trace;
there is no local-artifact fallback for grading.

---

## Prerequisites

### 1. Install Node dependencies

The eval scripts (`tsx`, `langsmith`, `dotenv`, `openai`) are devDependencies. From the
repo root:

```bash
npm install
```

> **Common error:** `Error: Cannot find module 'langsmith'` when running `eval:grade`
> means deps aren't installed — run `npm install`. (`langsmith` is required by
> `langsmith-reader.ts` even for tool-coverage grading.)

### 2. Install the coding-agent CLIs you plan to use

- **Claude Code** — `claude` on PATH
- **Cursor** — `cursor-agent` on PATH
- **Codex** — `codex` on PATH

### 3. Install the LangSmith coding-agent tracing plugin for each harness

Grading reads the trace back from LangSmith, so the corresponding plugin **must** be
installed and configured for whichever harness you run. See LangSmith's coding-agent
tracing docs: <https://www.langchain.com/blog/your-coding-agents-are-a-black-box-heres-how-to-crack-them-open>.
The adapters enable tracing via `TRACE_TO_LANGSMITH=true` plus the harness-specific
`*_LANGSMITH_*` env vars and stamp the `eval_run_id` correlation metadata.

> If no trace with a matching `eval_run_id` appears within the grader's poll window,
> the case is recorded as `grading_error` (no local fallback). This almost always
> means the plugin is not installed/configured for that harness.

### 3. Build the MCP server

```bash
npm run build
```

---

## Configuration

Set these in a `.env` file at the repo root (loaded automatically):

```bash
# LangSmith (shared project; runs are filtered by eval_run_id metadata)
export LANGSMITH_API_KEY="lsv2_..."
export LANGSMITH_PROJECT="your_project_name"

# Tableau (PAT auth)
export AUTH="pat"
export SERVER="https://your-site.online.tableau.com"
export SITE_NAME="your-site"
export PAT_NAME="your-pat-name"
export PAT_VALUE="your-pat-secret"

# BIRD California Schools suite
export EVAL_DATASOURCE_LUID="<luid-of-published-california-schools-datasource>"

# Agent under test
AGENT_HARNESS=claude-code        # claude-code | cursor | codex
# AGENT_MODEL=claude-sonnet-4-5  # optional; omit to use the CLI default

# Grader / semantic judge (runs headless via its own harness)
GRADER_HARNESS=claude-code       # claude-code | cursor | codex
# GRADER_MODEL=claude-sonnet-4-5

TRACE_TO_LANGSMITH=true
```

`AGENT_HARNESS`/`AGENT_MODEL` can also be overridden per invocation with
`--agent-harness` / `--agent-model`.

---

## BIRD California Schools Suite

The primary eval suite is 30 questions from the
[BIRD Mini-Dev benchmark](https://bird-bench.github.io/) scoped to the California
Schools database, joined into a single published Tableau datasource. The suite file at
`evals/suites/bird-california-schools.json` ships with precomputed expected answers, so
no database access is required to run evals.

### Run the full suite

```bash
npm run eval:suite
npm run eval:suite -- --difficulty simple                 # subset by difficulty
npm run eval:suite -- --ids 5,11,12                        # specific question IDs
npm run eval:suite -- --agent-harness codex --agent-model gpt-5.6-codex
```

### Grade a suite run (sources all metrics from LangSmith)

```bash
npm run eval:grade:suite                                          # most recent suite run
npm run eval:grade:suite -- evals/suite-runs/YYYY-MM-DD/<suite-run-id>
```

Output: `evals/grades/YYYY-MM-DD/<suite-run-id>/suite-grade.json`.

### Grade a single run

```bash
npm run eval:grade:bird -- evals/runs/YYYY-MM-DD/<run-id>
```

Output: `evals/grades/YYYY-MM-DD/<run-id>/bird-result.json`.

The semantic judge runs headless through `GRADER_HARNESS`/`GRADER_MODEL` (temperature 0
where the CLI supports it). Trace poll behavior is tunable with
`GRADE_TRACE_TIMEOUT_MS` (default 60000) and `GRADE_TRACE_POLL_MS` (default 5000).

### Ad hoc runs

```bash
npm run eval:run -- input "how many schools have SAT scores above 1200?"
npm run eval:grade -- evals/runs/YYYY-MM-DD/<run-id>   # tool-coverage grading (trace-sourced)
```

---

## Admin Tool Cases

`evals/cases/admin/` holds tool-coverage cases for the admin tools — both read-only
(`list-users`, `query-admin-insights`) and mutation tools run in **preview mode**
(`update-user`, `delete-content`, `update-cloud-extract-refresh-task`). Full onboarding
guide: [`ADMIN_EVALS.md`](./ADMIN_EVALS.md). The essentials:

### Extra configuration

Admin tools are gated and require a **site-admin PAT** (`SiteAdministratorCreator`,
`SiteAdministratorExplorer`, or `ServerAdministrator`). Add to `.env`:

```bash
# Registers the admin tools (list-users, query-admin-insights, update-user,
# delete-content, update-cloud-extract-refresh-task). Requires a site-admin PAT.
ADMIN_TOOLS_ENABLED=true
INSIGHTS_TOOLS_ENABLED=true          # query-admin-insights

# Disposable throwaway targets on a NON-production test site, used by the
# mutation-preview cases (nothing is applied — preview phase only).
EVAL_UPDATE_USER_LUID=<disposable-test-user-luid>
EVAL_DELETE_WORKBOOK_LUID=<disposable-test-workbook-luid>
EVAL_EXTRACT_TASK_LUID=<disposable-extract-refresh-task-luid>   # Cloud only
```

> `run-case.ts`'s `tableauServerEnv()` forwards `ADMIN_TOOLS_ENABLED` /
> `INSIGHTS_TOOLS_ENABLED` / `FEATURE_GATE_PROVIDER[_CONFIG]` / `FLOW_TOOLS_ENABLED` to
> the MCP stdio subprocess. Without that passthrough the admin tools never register and
> every admin case fails with `missing_tools`.

### Run the admin cases

```bash
npm run build

# read-only smoke tests (cheapest — prove the gate + PAT work)
npm run eval:run -- evals/cases/admin/list-users.json
npm run eval:run -- evals/cases/admin/query-admin-insights.json

# mutation PREVIEW cases (safe — nothing is applied)
npm run eval:run -- evals/cases/admin/update-user-preview.json
npm run eval:run -- evals/cases/admin/delete-content-preview.json
npm run eval:run -- evals/cases/admin/update-extract-refresh-task-preview.json

# grade each (tool coverage from the LangSmith trace)
npm run eval:grade -- evals/runs/$(date +%F)/<run-id>
```

These are tool-coverage cases (no gold numeric answer) — run one-per-file via `eval:run`
+ `eval:grade`, **not** the BIRD suite runner. See [`ADMIN_EVALS.md`](./ADMIN_EVALS.md)
for the mutation two-phase (preview→confirm) strategy and failure triage.

---

## Longitudinal Report

Roll up every graded case into cohorts by (harness × normalized model) and over time:

```bash
npm run eval:report
npm run eval:report -- --since 2026-07-01
npm run eval:report -- --harness codex --model gpt-5.6-codex
```

Output under `evals/reports/<timestamp>/`: `longitudinal.json`, `longitudinal.csv`,
`summary.md`. Per-case metrics: **accuracy** (verdict-derived), **latency**
(`wall_s`, `ttft_s`), **cost** (USD; LangSmith-reported or estimated from
`pricing.ts`), **tool-call count**, **error count**, token totals, and the four
quality signals.

---

## Grading Signals

| Signal | Method | What it checks |
|---|---|---|
| `numeric_match` | Code | Expected value / row count appears in the agent's final message (±1% for floats, substring for strings) |
| `semantic_match` | LLM judge via `GRADER_HARNESS` | Final message correctly answers the question vs. the gold summary |
| `columns_match` | Trace tool-call inspection | Expected VizQL field captions present in a `query-datasource` call |
| `filters_match` | Trace tool-call inspection | Expected filter field captions present in a `query-datasource` call |

`numeric_match` and `semantic_match` drive the verdict; `columns_match` / `filters_match`
are diagnostic (subset matching — extra columns/filters are fine).

### Verdicts

| Verdict | Meaning |
|---|---|
| `pass` | Both `numeric_match` and `semantic_match` passed |
| `partial` | One outcome signal passed (or one was unavailable) |
| `fail` | Both outcome signals failed |
| `error` | The agent exited non-zero, or the trace shows an error and no answer |
| `skip` | Both outcome signals were unavailable |
| `grading_error` | No matching LangSmith trace was found within the poll window |

---

## Architecture

| Module | Responsibility |
|---|---|
| `adapters/types.ts` | `AgentAdapter` interface + shared eval-metadata builder |
| `adapters/claude-code.ts`, `cursor.ts`, `codex.ts` | Per-harness CLI invocation, MCP config, plugin tracing env |
| `adapters/index.ts` | Harness registry + `resolveHarness` |
| `adapters/run-headless.ts` | One-shot headless prompt (no MCP) for the judge + JSON extraction |
| `langsmith-reader.ts` | Fetch a trace by `eval_run_id`; normalize tools/tokens/cost/timings |
| `model-normalize.ts` | Canonical model ids so the same model lines up across harnesses |
| `pricing.ts` | Per-model price map for cost fallback when LangSmith has no cost |
| `run-case.ts` | Run one case through the selected adapter; write `run.json` |
| `run-suite.ts` | Fan out cases; pass harness/model/suite-run-id through |
| `grade-bird.ts` | Trace-sourced BIRD grader + headless semantic judge |
| `grade-suite.ts` | Batch grade a suite run; aggregate quality/latency/cost |
| `grade.ts` | Ad hoc tool-coverage grader (trace-sourced) |
| `report.ts` | Longitudinal cohort report (JSON/CSV/Markdown) |

---

## Local Artifacts

Output directories are organized by date (`YYYY-MM-DD`).

```
evals/
  runs/YYYY-MM-DD/<run-id>/
    run.json              metadata, eval_run_id, harness/model, timing, exit code
    agent-output.jsonl    raw agent stream (debugging only; NOT a grading input)
    mcp-config.json / codex-home/ / cursor-workspace/   per-run MCP config (ephemeral)
    judge/                headless judge working dir (ephemeral)
    logs/                 MCP server file logs
  suite-runs/YYYY-MM-DD/<suite-run-id>/
    suite-summary.json    run-time metadata (wall/exit/timeout); metrics deferred to grading
    cases/                ephemeral per-case JSON files
  grades/YYYY-MM-DD/
    <run-id>/bird-result.json         per-case verdict + full metric set
    <suite-run-id>/suite-grade.json   aggregate grading output for a suite run
  reports/<timestamp>/    longitudinal.json / longitudinal.csv / summary.md
```

`evals/runs/`, `evals/suite-runs/`, `evals/grades/`, and `evals/reports/` are gitignored.

---

## Regenerating Expected Answers

The suite ships with precomputed answers, so **running and grading the suite needs no
BIRD snapshot**. Regeneration is rarely needed and requires the snapshot, which is **not
committed** (it is gitignored at `evals/bird_mini/`). Download the BIRD Mini-Dev dataset
from [bird-bench.github.io](https://bird-bench.github.io/) and place it so these paths
resolve under the repo root:

- `evals/bird_mini/data/dev_databases/california_schools/california_schools.sqlite`
- `evals/bird_mini/data/test_cases/mini_dev_sqlite.json`
- `evals/bird_mini/data/test_cases/mini_dev_postgresql_vds.json`

Then regenerate:

```bash
python3 evals/scripts/precompute-bird-answers.py
```

This executes the gold SQL from `bird_mini/data/test_cases/mini_dev_sqlite.json` against
`bird_mini/data/dev_databases/california_schools/california_schools.sqlite` and writes
`expected_value`, `expected_row_count`, `expected_columns`, `expected_filter_fields`, and
`ai_summarized_answer` into `evals/suites/bird-california-schools.json`.
```
