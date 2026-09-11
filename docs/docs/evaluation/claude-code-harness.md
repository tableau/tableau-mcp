---
sidebar_position: 1
---

# Claude Code Eval Harness

The Tableau MCP eval harness runs [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) as a live agent against the Tableau MCP server and grades its responses against known-correct answers. It is designed to measure query accuracy — not simulated tool calls, with real API round-trips to a live Tableau Cloud or Server site.

The primary benchmark is 30 questions from the [BIRD Mini-Dev](https://bird-bench.github.io/) dataset scoped to the California Schools database.

---

## Prerequisites

### Required

- **Claude Code** installed and available on your `PATH` (`claude --version` should work)
- **A published California Schools datasource** on your Tableau Cloud or Server site. This is a single published datasource that joins the three California Schools source tables (`schools`, `frpm`, `satscores`). You will need its LUID. A .tdsx for this data source ships in the BIRD Mini-Dev snapshot (see the eval [README](https://github.com/tableau/tableau-mcp/blob/main/evals/README.md#regenerating-expected-answers) for how to obtain it) at `evals/bird_mini/data/tableau_datasources/california_schools`; note `evals/bird_mini/` is gitignored and not committed.
- **Tableau credentials** — any supported auth method (PAT, OAuth, direct trust). See [Authentication](/docs/configuration/mcp-config/authentication) for setup.

### Optional

- **LangSmith account** — required for grading. Grading is sourced entirely from the LangSmith trace (there is no local-artifact grading path), so without a posted trace `grade.ts`/`grade-bird.ts` return `grading_error`. See [LangSmith Integration](#langsmith-integration).
- **A grader harness** — for semantic grading (LLM judge). The judge runs headless through a coding-agent harness (`GRADER_HARNESS`, default `claude-code`), NOT the OpenAI API. Without a usable harness, the verdict falls back to numeric-only grading.

---

## Environment Variables

Copy `env.example.list` to `.env` at the repo root and fill in the values below.

### Required

| Variable | Description |
|---|---|
| `SERVER` | Your Tableau Cloud or Server URL (e.g. `https://10ax.online.tableau.com`) |
| `SITE_NAME` | Your Tableau site name |
| `PAT_NAME` | Personal Access Token name |
| `PAT_VALUE` | Personal Access Token secret |
| `EVAL_DATASOURCE_LUID` | LUID of the published California Schools datasource. Find it in Tableau by opening the datasource and copying the ID from the URL. |

### Optional — LangSmith

| Variable | Default | Description |
|---|---|---|
| `LANGSMITH_API_KEY` | — | Your LangSmith API key. Get one at [smith.langchain.com](https://smith.langchain.com) → Settings → API Keys. If not set, traces are not posted. |
| `LANGSMITH_PROJECT` | `tableau-mcp-evals` | LangSmith project to post traces to. |

### Optional — Grading

| Variable | Default | Description |
|---|---|---|
| `GRADER_HARNESS` | `claude-code` | Coding-agent harness that runs the semantic-match LLM judge headless. One of `claude-code`, `cursor`, `codex`. If no usable harness is available, `semantic_match` is skipped and the verdict is based on `numeric_match` only. |
| `GRADER_MODEL` | harness default | Model the judge harness uses (e.g. `claude-sonnet-4-5`). Leave unset to use the harness's own default. |

---

## Running the Harness

### Run the full BIRD suite (30 questions)

```bash
npm run eval:suite
```

### Run a filtered subset

```bash
npm run eval:suite -- --difficulty simple       # only the 8 "simple" questions
npm run eval:suite -- --difficulty moderate     # only "moderate" questions
npm run eval:suite -- --ids 5,11,12             # specific question IDs
```

Difficulty levels map to the BIRD benchmark's own classifications: `simple`, `moderate`, and `challenging`.

### Run a single question by ID

```bash
npm run eval:suite -- --ids 5
```

### Run an ad hoc custom question

Pass any natural language prompt directly, without a suite file:

```bash
npm run eval:claude -- input "How many schools have an average SAT math score above 400?"
```

Ad hoc runs use the same Claude Code + Tableau MCP setup as suite runs and produce the same local artifacts. They are graded by `grade.ts` (tool coverage only), not `grade-bird.ts`, because there is no precomputed expected answer to compare against.

---

## Grading

### Grade a full suite run

After `eval:suite` completes, grade every case at once:

```bash
npm run eval:grade:suite                                                    # auto-discovers most recent
npm run eval:grade:suite -- evals/suite-runs/YYYY-MM-DD/<suite-run-id>     # explicit path
```

This writes a single `suite-grade.json` to `evals/grades/YYYY-MM-DD/<suite-run-id>/`.

### Grade a single run

```bash
npm run eval:grade:bird -- evals/runs/YYYY-MM-DD/<run-id>
```

Output goes to `evals/grades/YYYY-MM-DD/<run-id>/bird-result.json`.

---

## Grading Signals and Metrics

Each run is evaluated on four signals. The **verdict** is determined by the two outcome signals only. The structural signals are recorded for debugging purposes and do not affect the verdict.

### Outcome signals (drive the verdict)

| Signal | Method | Description |
|---|---|---|
| `numeric_match` | Code | The expected numeric value or row count appears in Claude's final message. Integer matches are exact; float matches allow ±1% tolerance. String answers (e.g. school names) use case-insensitive substring matching. |
| `semantic_match` | LLM judge | A headless coding-agent judge (`GRADER_HARNESS`/`GRADER_MODEL`) scores Claude's final message against the gold answer summary on a 0–1 scale. A score ≥ 0.8 passes. Skipped if no grader harness is available. |

### Structural signals (informational)

| Signal | Method | Description |
|---|---|---|
| `columns_match` | Tool call inspection | The expected VizQL field captions are present in the `query-datasource` call. Extra columns are allowed; only missing required columns count against this signal. |
| `filters_match` | Tool call inspection | The expected filter field captions are present in the `query-datasource` call. Same subset-matching logic as `columns_match`. |

### Verdicts

| Verdict | Meaning |
|---|---|
| `pass` | Both `numeric_match` and `semantic_match` passed |
| `partial` | One of the two outcome signals passed (or one was unavailable) |
| `fail` | Both outcome signals failed |
| `error` | Claude Code exited with a non-zero code |
| `skip` | Both outcome signals were unavailable (e.g. no grader harness and no numeric result to match) |

---

## Metrics Captured Per Run

Each case run records the following, available in `bird-result.json` (individual) or `suite-grade.json` (aggregated). All metrics are sourced from the LangSmith trace (the single source of truth for grading); the local `agent-output.jsonl` stream is kept for human debugging only.

| Metric | Source | Notes |
|---|---|---|
| `wall_s` | Trace | Wall time of the run, from the trace's root span |
| `tool_calls` | Trace | Total number of tool calls made |
| `tools_used` | Trace | Deduplicated list of tool names called |
| `model` | Trace | Model name reported in the trace |
| `tokens.input_tokens` | Trace | Summed across all LLM runs |
| `tokens.output_tokens` | Trace | Summed across all LLM runs |
| `tokens.cache_creation_tokens` | Trace | Prompt cache write tokens |
| `tokens.cache_read_tokens` | Trace | Prompt cache read tokens |
| `tokens.total_tokens` | Trace | Total tokens across all LLM runs |

---

## Output Directories

All output is written locally and gitignored. Directories are organized by date.

```
evals/
  runs/
    YYYY-MM-DD/
      <run-id>/              one folder per case run
        run.json             metadata, timing, exit code
        agent-output.jsonl   full agent stream (human debugging only — never a grading input)
        mcp-config.json      MCP server config handed to the agent
        logs/                MCP server logs

  suite-runs/
    YYYY-MM-DD/
      <suite-run-id>/
        suite-summary.json   aggregate timing and token counts for all cases in the run

  grades/
    YYYY-MM-DD/
      <run-id>/
        bird-result.json     per-case grading output
      <suite-run-id>/
        suite-grade.json     aggregate grading output for a full suite run
```

---

## LangSmith Integration

Grading reads tool coverage, metrics, and the agent's final message **from the LangSmith trace** — it is the single source of truth. If no trace is posted for a run, `grade.ts`/`grade-bird.ts` return `grading_error`, so a working LangSmith setup is required to grade.

The trace is posted by the coding-agent's LangSmith tracing plugin, not by this harness directly. For Claude Code, install the [langsmith-tracing plugin](https://github.com/langchain-ai/langsmith-claude-code-plugins); the adapter sets the `LANGSMITH_*`/`CC_LANGSMITH_*` environment for the agent subprocess, but the plugin must be installed for a trace to actually be posted. Setting `LANGSMITH_API_KEY` alone is not sufficient.

Traces are posted to the project set by `LANGSMITH_PROJECT` (default: `tableau-mcp-evals`). Each run is matched to its trace by `eval_run_id`.

---

## About the BIRD Dataset

The BIRD (BIg Bench for laRge-scale Database Grounded Text-to-SQL Evaluation) Mini-Dev benchmark is a standard text-to-SQL evaluation dataset. The 30 California Schools questions used here were selected because the underlying database can be represented as a single Tableau published datasource that joins three source tables.

The suite file at `evals/suites/bird-california-schools.json` ships with precomputed expected answers (row counts, scalar values, and gold answer summaries) so no database access is required to run grading. To regenerate it from the raw BIRD SQLite snapshot:

```bash
python3 evals/scripts/precompute-bird-answers.py
```

This requires the California Schools SQLite file at `evals/bird_mini/data/dev_databases/california_schools/california_schools.sqlite`.
