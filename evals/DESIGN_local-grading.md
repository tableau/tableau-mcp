# Design (DEFERRED): Local (LangSmith-free) Tool-Coverage Grading for TMCP Evals

> **Status: DEFERRED — not yet implemented.** Design captured for later execution.
> Prompted by: evals require a LangSmith account to grade; blocks forks/CI/anyone
> without one. This proposes a no-account tool-coverage grader. Pick up from the
> Files/Verification sections when ready.

## Context

The TMCP eval harness (`evals/`, branch `joecon/eval`) makes **LangSmith the single
source of truth** for grading. Both halves depend on it:

- **Write side:** each adapter enables the LangSmith coding-agent plugin
  (`TRACE_TO_LANGSMITH=true` + `*_LANGSMITH_*` env) so the run is traced.
- **Read side:** every grader (`grade.ts`, `grade-bird.ts`, `grade-suite.ts` via
  `grade-bird.ts`) calls `fetchTraceSummary()` in `langsmith-reader.ts` to pull the
  trace back and derive tool coverage / metrics.

Consequence: **no LangSmith account → no grades.** README states it outright ("no
local-artifact fallback for grading"). Anyone without an account (forks, CI, new team
members, us) is blocked. A corp/enterprise account is *not* required to fix this — a
free personal account works — but the harder problem is that the dependency is
**gratuitous for tool-coverage grading**, which is exactly what the 5 mutation/admin
cases (`evals/cases/admin/`) use.

The raw agent stream is **already** captured to `agent-output.jsonl`
(`run-case.ts:173` — the exact stdout of the agent CLI). Tool calls are in that file.
For tool-coverage grading we can parse it locally and skip LangSmith entirely.

**Outcome:** a `grade-local.ts` + `eval:grade:local` script that grades tool coverage
from `agent-output.jsonl`, producing a `result.json` byte-compatible with `grade.ts`,
with **zero network / zero LangSmith account**. `report.ts` then rolls it up unchanged.

Scope: **tool-coverage grading only** (the `grade.ts` verdict: expected tools present +
budget + exit + timeout). BIRD numeric/semantic judging (`grade-bird.ts`) is explicitly
out of scope for round 1 — see §Non-Goals.

---

## Key facts established (file:line)

- `run-case.ts:173` — `fs.writeFileSync(path.join(runDir,'agent-output.jsonl'), stdout)`.
  `agent-output.jsonl` == verbatim agent CLI stdout. `run.json` written at `:139`
  (initial) and `:183` (final) with: `run_id, case_id, eval_run_id, harness, model,
  langsmith_project, expected_tools, tags, metadata, budget, wall_ms, agent_exit_code,
  timed_out, error`.
- `grade.ts:48-98` — the decision logic to replicate exactly (see §2).
- `langsmith-reader.ts:14-47` — `TraceToolCall` / `TraceSummary` shapes; `:58-62`
  `normalizeToolName()` (split on `__`, take last, strip `tableau_`/`tableau-`).
- Adapter output formats:
  - `claude-code.ts:86-87` — `--output-format stream-json --verbose`. Tool-use line:
    `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__tableau__list-users","input":{...}}]}}`.
  - `cursor.ts:92` — `--output-format stream-json`. Same Anthropic-style
    `message.content[].tool_use` blocks (mirrors claude-code's `extractFinalText`
    logic at `:143-165`).
  - `codex.ts:118` — `exec --json`. Version-varying event shapes; `extractFinalText`
    (`:167-194`) already tolerates `item` / `msg` / top-level variants. Tool calls
    appear as function-call items (e.g. `item.item_type`/`type` containing
    `function_call`/`tool`/`mcp` with a `name`). Best-effort, same posture as
    `extractFinalText`.
- `types.ts:72-95` — `AgentAdapter` interface already has `extractFinalText(stdout)`.
  This is the clean seam: add a parallel `extractToolCalls(stdout)` method.
- Grader tree: `grade-suite.ts` spawns `grade-bird.ts` per case (`:29`,`:178`);
  `grade-bird.ts:29,392` imports `fetchTraceSummary/findVizqlQuery/makeClient/TraceSummary`.
  All grading bottoms out at `fetchTraceSummary`.
- `package.json:50-56` — eval scripts: `eval:run`, `eval:claude`, `eval:grade`,
  `eval:suite`, `eval:grade:bird`, `eval:grade:suite`, `eval:report`.

---

## Design

### Phase 0 (prerequisite): capture a real stream sample

**Risk:** no code in `evals/` parses tool-call lines today — `agent-output.jsonl` is
write-only ("human debugging only", `run-case.ts:172`), and the per-line tool-call JSON
schema is **not encoded anywhere** in the repo. The stream-json/`--json` tool-call event
shapes must be confirmed against real CLI output, not assumed.

Before writing `extractToolCalls`, capture one real run per available harness and save a
trimmed sample line as a test fixture:

```bash
npm run build
export ADMIN_TOOLS_ENABLED=true    # + admin PAT/SERVER/SITE_NAME
npm run eval:run -- evals/cases/admin/list-users.json
# inspect: evals/runs/<date>/<run-id>/agent-output.jsonl → find the tool_use / function_call line
```

**Decision: cover all three harnesses** (all are first-class in the adapter registry —
a local grader that can't grade a supported harness is a trap). But codex is treated
differently:

- claude-code shape is high-confidence: `{"type":"assistant","message":{"content":
  [{"type":"tool_use","name":"mcp__tableau__list-users","input":{…}}]}}` (allowlist is
  literally `mcp__tableau__*`; `extractFinalText` already walks `message.content[]`).
  **Cursor mirrors it** → same parser.
- **Codex `--json` shape is NOT in the repo** and is version-varying (its own
  `extractFinalText` hedges across `item`/`msg`/top-level). Build the codex parser from
  a **captured real sample** (Phase 0), never blind. **Fail-safe rule:** if a codex line
  isn't a recognizable tool/function-call event, skip it; if a codex run yields zero
  recognizable tool events, the grader treats it as **`grading_error`** (undetermined),
  **never a false `pass`**. "Supported" must not degrade into "silently wrong."

### Seam: add `extractToolCalls` to the adapter interface

Each adapter already owns knowledge of its own stdout format (`extractFinalText`). Add a
sibling method so the local grader stays harness-agnostic — no format `switch` in the
grader.

`evals/adapters/types.ts` — extend `AgentAdapter`:

```ts
/** A tool call recovered from the agent's raw stdout stream. */
export type LocalToolCall = { name: string; input?: unknown };

export interface AgentAdapter {
  // ...existing...
  /**
   * Recover the ordered list of tool calls from this agent's raw stdout.
   * Best-effort and format-specific, mirroring extractFinalText. Names are RAW
   * (e.g. "mcp__tableau__list-users"); the grader normalizes.
   */
  extractToolCalls(stdout: string): Array<LocalToolCall>;
}
```

Implement per adapter:

- **claude-code.ts / cursor.ts** — scan JSONL lines; for each `type:"assistant"` event,
  walk `message.content[]`, collect blocks where `b.type === "tool_use"` → `{name:b.name,
  input:b.input}`. (Reuse the exact content-array walk already in `extractFinalText`.)
- **codex.ts** — scan JSONL lines; collect events whose `item`/`msg`/top-level shape is a
  function/tool/MCP call carrying a `name` (+ `arguments`/`input`). Tolerate variants
  like `extractFinalText` does; unknown shapes are skipped, not thrown.

Unit-test each with a captured sample line (see §Verification).

### `evals/grade-local.ts` — the grader (mirror of `grade.ts`, local source)

Same CLI contract as `grade.ts`: `tsx evals/grade-local.ts <run-dir>`.

1. Read `run.json` from `<run-dir>` (same `RunMeta` type as `grade.ts:29-41`).
2. Read `agent-output.jsonl` from `<run-dir>`. If missing/empty → `outcome:'grading_error'`
   with `trace_error:"agent-output.jsonl missing or empty"` (parallels the no-trace case).
   **Fail-safe for unparseable streams:** if the file is present+non-empty but
   `extractToolCalls` returns `[]` **and** `expected_tools` is non-empty, return
   `grading_error` (`trace_error:"no tool calls parsed from stream (unrecognized <harness>
   format)"`) rather than `fail`. A tool the agent *did* call but we failed to parse must
   not be scored as a miss — undetermined ≠ fail. (If `expected_tools` is empty, `[]` is a
   legitimate `pass`.)
3. Resolve the adapter via `getAdapter(runMeta.harness ?? 'claude-code')`
   (`adapters/index.ts`), call `adapter.extractToolCalls(stdout)`.
4. `observedTools = [...new Set(calls.map(c => normalizeToolName(c.name)))]`
   (import `normalizeToolName` from `langsmith-reader.ts` — pure, no network).
   `toolCalls = calls.length`.
   `missingTools = expectedTools.filter(t => !observedTools.includes(normalizeToolName(t)))`.
5. **Outcome — identical order to `grade.ts:68-75`:**
   ```
   if (!stdoutPresent)                         return 'grading_error';
   if (runMeta.timed_out)                       return 'timeout';
   if (agent_exit_code != null && !== 0)        return 'error';
   if (toolCalls > maxToolCalls)                return 'budget_exceeded';
   if (missingTools.length > 0)                 return 'fail';
   return 'pass';
   ```
   **Budget key-casing fix (real bug — verified):** `run-case.ts:89-91` writes
   `budget: {maxToolCalls, maxWallMs}` (camelCase), but `grade.ts:72` reads
   `budget.max_tool_calls` (snake_case) → always `undefined` → `toolCalls > undefined`
   is always `false`, so **`budget_exceeded` never fires in the existing grader.**
   `grade-local.ts` MUST read `const maxToolCalls = budget.maxToolCalls ??
   budget.max_tool_calls ?? Infinity;` so the budget check actually works. Flag the
   `grade.ts` bug to the team (separate one-line fix; drive-by in the same PR).
6. Write `<run-dir>/result.json` with the **same field set** `grade.ts:77-98` produces,
   so `report.ts` consumes it unchanged. Fields sourced locally:
   - `observed_tools`, `missing_tools`, `tool_calls` — from the stream.
   - `cost_usd: null`, `llm_calls: null` — not derivable locally (report tolerates null).
   - `model: runMeta.model ?? null`, `wall_ms: runMeta.wall_ms ?? null`,
     `trace_id: null`, `trace_error: null`.
   - Add `grader: 'local'` (new field; ignored by `report.ts`, distinguishes source).
7. Console summary block mirroring `grade.ts:103-111`.

### `package.json` script

Add: `"eval:grade:local": "tsx evals/grade-local.ts"`.

### Docs

- Update `evals/ADMIN_EVALS.md` §7/§8: show `eval:grade:local` as the
  no-account path for the 5 mutation/admin cases; note cost/llm_calls are null locally.
- Update `evals/README.md`: add a "Grading without LangSmith" subsection pointing at
  `eval:grade:local` and stating the tradeoff (tool-coverage only; no cost/token/latency
  breakdown, no semantic judge).

---

## Files

| File | Change |
|---|---|
| `evals/adapters/types.ts` | Add `LocalToolCall` type + `extractToolCalls` to `AgentAdapter` |
| `evals/adapters/claude-code.ts` | Implement `extractToolCalls` (tool_use blocks) |
| `evals/adapters/cursor.ts` | Implement `extractToolCalls` (tool_use blocks) |
| `evals/adapters/codex.ts` | Implement `extractToolCalls` (function/tool-call events, best-effort + fail-safe) |
| `evals/grade-local.ts` | **New.** Local tool-coverage grader (mirror of `grade.ts`) |
| `evals/grade.ts` | Drive-by: fix budget key-casing (`maxToolCalls ?? max_tool_calls`) |
| `package.json` | Add `eval:grade:local` script |
| `evals/ADMIN_EVALS.md` | Document the no-account grading path |
| `evals/README.md` | "Grading without LangSmith" subsection |
| `evals/adapters/*.test.ts` (new) | Unit tests for `extractToolCalls` per adapter |
| `evals/grade-local.test.ts` (new) | Unit test for outcome logic on fixture run-dirs |

Reuse (no new impl): `normalizeToolName` (`langsmith-reader.ts:58`), `getAdapter`
(`adapters/index.ts`), the `RunMeta` shape + outcome ladder (`grade.ts`).

---

## Non-Goals (round 1)

- **BIRD numeric/semantic grading offline.** `grade-bird.ts`'s `numeric_match` reads the
  final text (already local via `extractFinalText`) but `semantic_match` needs an LLM
  judge and `columns_match`/`filters_match` need tool-call *inputs*. A follow-up can add
  `grade-bird-local.ts` using `extractToolCalls` inputs + `findVizqlQuery` (both already
  local-capable) — deferred to keep round 1 tight.
- **Cost/token/latency metrics.** These come from LangSmith LLM runs; not in the agent
  stdout stream. Emitted as `null` locally.
- **Removing LangSmith tracing from adapters.** Tracing stays (opt-in, harmless when
  `LANGSMITH_API_KEY` is empty). We only add a local *read* path; we don't touch the
  write path.

---

## Verification

1. **Build:** `npm run build` (grader is tsx, no build needed, but keep tree green).
2. **Unit:** `npm run test -- evals/adapters` and `npm run test -- evals/grade-local`
   — `extractToolCalls` returns the seeded tool names per harness; outcome ladder hits
   every branch (pass / fail-missing / budget_exceeded / timeout / error / grading_error)
   from fixture `run.json` + `agent-output.jsonl` pairs.
3. **End-to-end, no LangSmith** (the real proof):
   ```bash
   unset LANGSMITH_API_KEY
   export ADMIN_TOOLS_ENABLED=true            # + admin PAT, SERVER, SITE_NAME
   npm run build
   npm run eval:run -- evals/cases/admin/list-users.json   # note printed run-dir
   npm run eval:grade:local -- evals/runs/$(date +%F)/<run-id>
   ```
   Expect `result.json` with `outcome:"pass"`, `observed_tools:["list-users"]`,
   `missing_tools:[]`, `grader:"local"`, and **no network call / no account error**.
4. **Cross-check against LangSmith path (if an account is available):** run
   `npm run eval:grade` and `npm run eval:grade:local` on the *same* run-dir; assert
   identical `outcome` / `observed_tools` / `missing_tools`. This proves the local parser
   agrees with the trace parser.
5. **Report roll-up:** `npm run eval:report` includes the local-graded case with
   accuracy populated and cost/tokens blank — confirms `result.json` compatibility.
6. **Codex fail-safe:** run one case with `--agent-harness codex`, then
   `eval:grade:local`. If the codex parser recognizes its events → coverage matches the
   LangSmith path (step 4). If not → `outcome:"grading_error"` with the "no tool calls
   parsed" message, **never a false `pass`/`fail`**. Confirm which branch fired against
   the captured Phase 0 sample.
