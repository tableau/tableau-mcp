# Design (DEFERRED): `eval:probe` — one-shot run+grade helper for any tool/prompt

> **Status: DEFERRED — not yet implemented.** Spec captured for later.
> **Hard dependency:** `grade-local.ts` (see `DESIGN_local-grading.md`). This helper is
> only useful once tool-coverage grading works offline; chaining `eval:run` + the current
> LangSmith-only `eval:grade` yields `grading_error` every time without an account.

## Context

Probing "does the agent call tool X for prompt Y?" today takes 3 manual steps: hand-write
a case JSON (or use `eval:run -- input "..."`), run it, then read `agent-output.jsonl` by
eye — because `eval:grade` needs a LangSmith trace and errors out offline. We want one
command that runs an ad hoc tool/prompt and prints a local pass/fail with observed tools.

The run side is already flexible: `run-case.ts` ad hoc mode
(`npm run eval:run -- input "<prompt>"`, `run-case.ts:191-207`) accepts any prompt with no
case file. The gap is a grader that works offline + a wrapper that ties run→grade→verdict
into a single invocation with an `expected_tools` assertion.

## Outcome

```bash
npm run eval:probe -- --tool list-users --prompt "list all users on the site"
npm run eval:probe -- --prompt "disable user {{env.EVAL_UPDATE_USER_LUID}}" --expect update-user
npm run eval:probe -- --case evals/cases/admin/list-users.json   # existing case, local grade
```
Prints: harness/model, observed tools, missing tools, `tool_calls`, and a
`pass | fail | grading_error` verdict — **zero LangSmith, zero account.**

## Design

Thin orchestrator `evals/probe.ts` + `"eval:probe": "tsx evals/probe.ts"` in
`package.json`. No new grading/parsing logic — it composes existing pieces.

1. **Resolve the case.** Either `--case <path>` (existing JSON) or synthesize an ephemeral
   case from `--prompt` + `--tool`/`--expect` (repeatable → `expected_tools[]`) + optional
   `--budget-calls` / `--budget-ms`. Reuse the ad hoc case shape from `run-case.ts:198-206`.
   Write the synthesized case to a temp file (or pass through `input` mode when no
   `expected_tools` are asserted).
2. **Run.** Shell out to `eval:run` (same env passthrough / preflight as today). Capture the
   printed run-dir (or pass an explicit `--run-id` and compute the dir).
3. **Grade locally.** Shell out to `eval:grade:local -- <run-dir>` (from
   `DESIGN_local-grading.md`). Read back `result.json`.
4. **Report.** Print the verdict block: `outcome`, `observed_tools`, `missing_tools`,
   `tool_calls`, run-dir path. Exit non-zero on `fail` / `grading_error` so it's CI/script
   usable.

## Flags

| Flag | Meaning |
|---|---|
| `--prompt "<text>"` | Ad hoc user message (supports `{{env.VAR}}` expansion, `run-case.ts:271`). |
| `--tool <name>` / `--expect <name>` | Expected tool (repeatable). Empty ⇒ run-only, no assertion. |
| `--case <path>` | Use an existing case file instead of `--prompt`. |
| `--agent-harness` / `--agent-model` | Passthrough to `eval:run`. |
| `--budget-calls` / `--budget-ms` | Override case budget (else run-case defaults). |
| `--keep` | Keep the ephemeral case/run dir (default: leave run dir, it's gitignored). |

## Files

| File | Change |
|---|---|
| `evals/probe.ts` | **New.** Orchestrator: synth case → `eval:run` → `eval:grade:local` → verdict. |
| `package.json` | Add `"eval:probe"` script. |
| `evals/README.md` | "Quick tool probe" subsection. |

Reuse (no new impl): ad hoc case shape + `expandTemplate` (`run-case.ts`), `getAdapter`
(`adapters/index.ts`), local grader + `normalizeToolName` (`DESIGN_local-grading.md` /
`langsmith-reader.ts:58`).

## Non-Goals

- **BIRD numeric/semantic probing.** Tool-coverage verdict only, same scope as the local
  grader. Numeric/semantic stays on `eval:grade:bird` (LangSmith).
- **Replacing the suite runner.** `eval:probe` is single ad hoc case; `eval:suite` stays
  the batch path.
- **New parsing.** All stream parsing lives in `extractToolCalls` (adapters); probe only
  composes.

## Verification

1. `npm run eval:probe -- --tool list-users --prompt "list users"` on a healthy server →
   `pass`, `observed_tools:["list-users"]`, exit 0.
2. Deliberately wrong expectation (`--expect delete-content` on a list prompt) → `fail`,
   `missing_tools:["delete-content"]`, exit non-zero.
3. Server down / no tool call → `grading_error` (never false pass), exit non-zero.
4. `--case <existing>` path grades identically to `eval:grade:local -- <run-dir>` on the
   same run.
