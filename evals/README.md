# Tableau MCP Eval Harness

This folder contains a local eval harness that runs Claude Code against the Tableau MCP server,
routes traces to LangSmith, and grades agent responses against known-correct answers.

## How It Works

```
suite file (bird-california-schools.json)
  → run-suite.ts
    → run-case.ts (one per question)
      → claude -p --mcp-config ... --settings ...
        → tableau-mcp stdio server
        → Claude Code hooks (PreToolUse / PostToolUse / Stop)
          → LangSmith (traces posted in real time)
          → pre-tool-times.jsonl, hook.jsonl (local timing records)
      → agent-output.jsonl (full Claude stream)
    → suite-summary.json (timing, tokens, tool counts per case)
  → grade-bird.ts (one per run, grades the 4 signals)
    → grades/YYYY-MM-DD/<run-id>/bird-result.json (per-case verdict)
```

Claude Code is the eval runtime — not a simulated agent. Every tool call goes to the real Tableau Cloud or Server APIs. LangSmith receives the full trace while the run is in progress.

---

## Setup

### 1. Build the MCP server

```bash
npm run build
```

### 2. Set credentials

```bash
# LangSmith
export LANGSMITH_API_KEY="ls__..."
export LANGSMITH_PROJECT="your_project_name"

# Tableau (PAT auth)
export AUTH="pat"
export SERVER="https://your-site.online.tableau.com"
export SITE_NAME="your-site"
export PAT_NAME="your-pat-name"
export PAT_VALUE="your-pat-secret"

# BIRD California Schools suite
export EVAL_DATASOURCE_LUID="<luid-of-published-california-schools-datasource>"

# LLM judge (for semantic grading)
export OPENAI_API_KEY="sk-..."
```

Or put these in a `.env` file at the repo root.

---

## BIRD California Schools Suite

The primary eval suite is 30 questions from the
[BIRD Mini-Dev benchmark](https://bird-bench.github.io/) scoped to the California Schools database.
A single published Tableau datasource joins the source tables (schools, frpm, satscores).

The suite file lives at `evals/suites/bird-california-schools.json` and is committed to the repo.
It contains precomputed expected answers so no database access is required to run evals.

### Run the full suite

```bash
npm run eval:suite
```

### Run a subset

```bash
npm run eval:suite -- --difficulty simple       # 8 simple cases
npm run eval:suite -- --ids 5,11,12             # specific question IDs
```

### Grade a full suite run

After `eval:suite` completes, grade every case at once and produce a single `suite-grade.json`:

```bash
npm run eval:grade:suite                                          # auto-discovers most recent suite run
npm run eval:grade:suite -- evals/suite-runs/YYYY-MM-DD/<suite-run-id>  # explicit
```

Output is written to `evals/grades/YYYY-MM-DD/<suite-run-id>/suite-grade.json`.

### Grade a single run

```bash
npm run eval:grade:bird -- evals/runs/YYYY-MM-DD/<run-id>
```

Output is written to `evals/grades/YYYY-MM-DD/<run-id>/bird-result.json`.

Override the LLM judge model (default: `gpt-4o-mini`) for either grader:

```bash
BIRD_GRADE_MODEL=gpt-4o npm run eval:grade:suite
```

---

## Grading Signals

Each run is graded on four signals. The verdict is driven by the outcome signals only; the structural signals are recorded for debugging.

### Outcome signals (drive the verdict)

| Signal | Method | What it checks |
|---|---|---|
| `numeric_match` | Code | Expected value or row count appears in Claude's final message (±1% tolerance for floats, substring match for strings) |
| `semantic_match` | LLM judge (GPT-4o-mini) | Claude's final message correctly answers the question vs. the gold summary |

### Structural signals (informational)

| Signal | Method | What it checks |
|---|---|---|
| `columns_match` | Tool call inspection | Expected VizQL field captions present in `query-datasource` call |
| `filters_match` | Tool call inspection | Expected filter field captions present in `query-datasource` call |

The structural signals use subset matching — extra columns or filters are fine. They help diagnose
*why* an agent failed but don't block a correct answer from passing.

### Verdicts

| Verdict | Meaning |
|---|---|
| `pass` | Both `numeric_match` and `semantic_match` passed |
| `partial` | One of the two outcome signals passed (or one was unavailable) |
| `fail` | Both outcome signals failed |
| `error` | Claude Code exited with a non-zero code |
| `skip` | Both outcome signals were unavailable (e.g. no OpenAI key) |

---

## Expected Answers

The suite file ships with precomputed answers from the executed sql against the source of truth california schools table. If you wanted to regenerate it (there's probably no reason to) run the following file (requires the BIRD SQLite snapshot):

```bash
python3 evals/scripts/precompute-bird-answers.py
```

This reads the gold SQL from `bird_mini/data/test_cases/mini_dev_sqlite.json`, executes it against
`bird_mini/data/dev_databases/california_schools/california_schools.sqlite`, and writes
`evals/suites/bird-california-schools.json` with:

- `expected_value` — scalar result (for COUNT, MAX, MIN queries)
- `expected_row_count` — number of rows returned (for list queries)
- `expected_columns` — VizQL field captions that should appear in the query
- `expected_filter_fields` — filter field captions from the reference VDS query
- `ai_summarized_answer` — natural language gold answer (for the LLM judge)

---

## Local Artifacts

All output directories are organized by date (`YYYY-MM-DD`) so runs and grades from different days stay separate.

```
evals/
  runs/
    YYYY-MM-DD/
      <run-id>/
        run.json                  metadata, timing, exit code, question_id
        agent-output.jsonl        raw Claude Code stream JSON (all events)
        hook.jsonl                one record per tool call (name, input, timing)
        pre-tool-times.jsonl      PreToolUse timestamps keyed by tool_use_id
        stop.json                 Stop hook data (transcript path, session info)
        claude-settings.json      per-run hook config (ephemeral)
        mcp-config.json           per-run MCP server config (ephemeral)
        logs/                     MCP server file logs

  suite-runs/
    YYYY-MM-DD/
      <suite-run-id>/
        suite-summary.json        aggregate: timing, tokens, tool counts per case
        cases/                    ephemeral per-case JSON files written before each run

  grades/
    YYYY-MM-DD/
      <run-id>/
        bird-result.json          per-case grading output (4 signals + verdict)
      <suite-run-id>/
        suite-grade.json          aggregate grading output for a full suite run
```

`evals/runs/`, `evals/suite-runs/`, and `evals/grades/` are all gitignored.

---

## Ad Hoc Runs

Run a single natural-language prompt without a case file:

```bash
npm run eval:claude -- input "how many schools have SAT scores above 1200?"
```

Ad hoc runs are tagged `adhoc`, use the existing `grade.ts` grader (not `grade-bird.ts`), and
produce the same local artifacts.

---

## LangSmith Trace Structure

Each eval case produces one parent `chain` run in LangSmith containing all child spans for that
case. The parent's `start_time` and `end_time` are the wall clock times of the `claude -p` process.

### Child spans

| Span name | Type | Source | Timing |
|---|---|---|---|
| `initialization` | `chain` | `run-case.ts` (post-process) | `startedAt` → first stream event |
| `assistant-message-N` | `llm` | `run-case.ts` (post-process) | inferred from stream timestamps |
| `<tool-name>` | `tool` | `PostToolUse` hook (real time) | `PreToolUse ts` → `PostToolUse ts` |
| `claude-result-<subtype>` | `chain` | `run-case.ts` (post-process) | pinned to `finishedAt` |

### How span timing is calculated

**Tool call spans** (`<tool-name>`) are the most accurate. The `PreToolUse` hook fires the instant Claude Code dispatches the tool call and writes `{tool_use_id, ts}` to `pre-tool-times.jsonl`. The `PostToolUse` hook fires when the MCP server returns and uses the matching `ts` as `start_time`. This gives true MCP round-trip latency.

**Assistant message spans** are inferred after Claude exits by parsing `agent-output.jsonl`. The inference works in three layers:

1. **Real timestamps** — if the stream event carries a `timestamp` field, it is used directly.
2. **Hook anchors** — for any assistant event whose content contains a `tool_use` block, the `PreToolUse` timestamp for that `tool_use_id` is injected as the event's real end time, and the `PostToolUse` timestamp is injected as the start time of the next event. This anchors the timeline at every tool call boundary.
3. **Linear interpolation** — events between anchors are distributed proportionally by index between the surrounding anchor times.

The `end_time` of each assistant message is the `start_time` of the next traceable event, so spans tile continuously rather than all ending at the same moment.

**Initialization span** is a synthetic `chain` span posted after Claude exits. It covers the window from process launch to the first stream event — Claude Code startup, MCP server subprocess launch, and tool capability negotiation. This ensures the full wall clock time is accounted for in the langsmith trace waterfall.

### Known gap

The `claude-result-success` span is always posted with `start_time = end_time = finishedAt` (0.00s) because it represents the Claude Code process exit signal, not a timed operation.
