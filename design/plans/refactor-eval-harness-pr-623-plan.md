# Refactor eval harness in PR #623 (tableau/tableau-mcp) for readability

## Context

PR #623 (`asimantov/eval-admin-tools`, external author, open against `main`) adds an eval
harness under `evals/` — 21 new admin/JTBD eval cases plus a multi-agent runner (Claude
Code/Cursor/Codex adapters) and BIRD-benchmark grading pipeline. A prior logic-correctness
review found no functional bugs and CI is green, but a code-quality pass confirmed the harness
code itself is not well refactored. Root cause: every `evals/*.ts` file is a standalone CLI
script with all logic inlined in `main()` — there's no shared, importable, unit-testable
library layer, so common logic (result schemas, JSONL parsing, subprocess error handling,
stats) got copy-pasted or re-declared independently across files instead of factored out.

This branch off `origin/asimantov/eval-admin-tools` is a pure refactor — no behavior change —
intended to be opened as a PR with base `asimantov/eval-admin-tools` so the author can review
and merge it before their work lands on `main`. Every step must be checked against re-running
the harness scripts to confirm identical output before/after.

## Ground truth (confirmed by direct file reads at tip `0fab98b0`)

- `grade.ts` (151 lines, no exports) is **orphaned** — never invoked by `grade-suite.ts` or
  `run-suite.ts`, only referenced as a printed usage hint in `run-case.ts:199`. Leave it alone;
  out of scope (touching it risks scope creep with no readability payoff for the files that are
  actually tangled).
- `grade-bird.ts` `main()` spans **lines 305–531** (227 lines): loads run.json + suite file,
  fetches LangSmith trace, computes columns/filters/numeric/semantic signals, derives
  verdict/accuracy via inline magic numbers, writes result, prints summary — no unit-testable
  seams.
- `BirdGradeResult`-shaped type independently hand-declared 3×: `grade-bird.ts:87-139`
  (canonical/richest — includes `subagent_count`, `cost_source`, `details`, `grader_*`),
  `grade-suite.ts:59-90` (`BirdResult`, slimmer), `report.ts:37-65` (`BirdResult`, slimmer
  still). All three are re-typings of the same on-disk `bird-result.json` shape.
- `grade-suite.ts` invokes `grade-bird.ts` via **subprocess**, not import:
  `execFileSync('npx', ['tsx', GRADE_BIRD_SCRIPT, c.run_dir], ...)` at **lines 186–190**, then
  re-reads/re-parses the `bird-result.json` file grade-bird.ts wrote (**lines 191–192**).
  Errors from the subprocess are narrowed to an opaque string (**lines 196–199**).
- `extractFinalText` (JSONL-scan-for-final-message) duplicated near-identically: `claude-code.ts`
  **125–160** and `cursor.ts` **129–167** (both: try direct JSON.parse of stdout, else scan
  JSONL backwards for `type==='result'` or `message.content`). Codex's version (`codex.ts:
  167–194`) has a genuinely different event shape — not part of this duplication, leave as-is.
- MCP-config object literal duplicated verbatim: `claude-code.ts:53-66` and `cursor.ts:63-76`
  (same `{mcpServers:{tableau:{command,args,env}}}` shape, only the destination file path
  differs). `codex.ts` renders TOML instead — not a third duplicate, leave as-is.
- `execFileSync` error-narrowing "`err as {...}`" idiom hand-copied 4× with different field
  subsets: `run-case.ts:164-179` (richest — status/stdout/stderr/message/killed/signal),
  `evals/adapters/run-headless.ts:29-34` (status/stdout/stderr/message),
  `grade-suite.ts:196-199` (message/stderr), `run-suite.ts:238-241` (message only).
- Stats helpers duplicated with inconsistent behavior: `report.ts:119-133` has standalone
  `mean`/`sum`/`round`/`rate`; `grade-suite.ts:256-258` only has local `mean`/`sum` (declared
  inside `main()`), with rounding done ad hoc inline at lines 283-296 instead of via a shared
  `round`/`rate`.

## Design

All changes are additive-extraction + import-swap — no behavioral change to what gets written
to `run.json`/`bird-result.json`/`suite-grade.json`/reports, and no change to CLI arguments or
exit codes. New shared modules go in a new `evals/lib/` directory (mirrors the existing
`evals/adapters/` convention of a shared subfolder).

### 1. `evals/lib/birdResult.ts` — canonical result type
Move the richest existing shape (`grade-bird.ts:87-139`'s `BirdGradeResult`) here verbatim as
the single exported type. Update `grade-bird.ts`, `grade-suite.ts`, `report.ts` to `import type
{ BirdGradeResult } from './lib/birdResult.js'` and delete their local re-declarations
(`BirdResult` in grade-suite.ts and report.ts). Since grade-suite.ts/report.ts's local shapes
were strict subsets, importing the richer canonical type is a safe widen — any code accessing a
field must still find it present (TypeScript will catch anything genuinely incompatible).

### 2. `evals/lib/execError.ts` — shared subprocess error narrowing
One exported function, `captureExecError(error: unknown): { exitCode?: number; stdout?: string;
stderr?: string; message: string; timedOut?: boolean }`, covering the union of fields the 4
call sites currently narrow individually (richest shape from `run-case.ts:164-179`). Each call
site destructures only the fields it already used — e.g. `grade-suite.ts` keeps using
`.message`/`.stderr`, `run-suite.ts` keeps using only `.message`. Replace the 4 inline
`catch (err) { const e = err as {...}; ... }` blocks with a call to this function.

### 3. `evals/lib/stats.ts` — shared stats helpers
Move `report.ts:119-133`'s `mean`/`sum`/`round`/`rate` here verbatim (they're already the most
complete/consistent versions). Update `report.ts` to import from here. Update `grade-suite.ts`
to import `mean`/`sum`/`round`/`rate` from here instead of its local partial reimplementation,
and replace its inline ad hoc rounding (lines 283-296) with `round(...)`/`rate(...)` calls —
this also fixes the rounding-inconsistency side effect the review flagged, as a byproduct of
deduplication (verify output values are unchanged for existing sample data, since `round`'s
precision must match what grade-suite currently does inline).

### 4. `evals/adapters/streamJson.ts` — shared JSONL final-text extraction
Extract `claude-code.ts`'s `extractFinalText` (lines 125-160, the more defensive/complete of the
two near-identical copies) into one exported `extractFinalTextFromStreamJson(stdout: string):
string`. Update `claude-code.ts` and `cursor.ts` to import and call it, deleting both inline
copies. Leave `codex.ts`'s structurally-different version alone.

### 5. Shared MCP config builder
Add `buildStandardMcpConfig(ctx: RunContext): { mcpServers: {...} }` to `evals/adapters/types.ts`
(alongside the existing `buildEvalMetadata` helper, which lives there for the same "shared
adapter utility" reason). Update `claude-code.ts:53-66` and `cursor.ts:63-76` to call it and
write the result to their respective destination paths, deleting the duplicated literal.

### 6. Decompose `grade-bird.ts`'s `main()`
Split the 227-line function into named, individually-testable pieces, keeping `main()` as a thin
orchestrator:
- `loadGradingContext(runDir: string): { runMeta, birdCase, ... }` — lines 306-331 (fs reads +
  case lookup).
- `computeSignals(birdCase, traceSummary, finalMessage): { columnsMatch, filtersMatch,
  numericMatch, semanticMatch }` — lines 433-475, calling existing pure helpers
  (`collectFieldCaptions`/`collectFilterCaptions`/`checkNumericMatch`) plus the `runJudge` call
  for `semanticMatch` (this piece keeps its subprocess I/O — extracting it as a named function is
  still valuable for readability, "pure" isn't a hard requirement here since `runJudge` itself
  already is a separate documented function).
- `deriveVerdict(signals): { verdict, accuracy }` — lines 477-496, isolating today's magic-number
  thresholds (e.g. `>= 0.8` semantic threshold) into one small, nameable function.
- `main()` becomes: load context → fetch trace (early-return on failure, unchanged) → populate
  metrics → `computeSignals(...)` → `deriveVerdict(...)` → `writeResult(...)` (already a
  separate function) → `printSummary(...)` (new: hoist the lines 500-530 console.log block into
  its own function, mirroring `writeResult`'s existing pattern).

### 7. `grade-suite.ts`: subprocess → direct call
Extract `grade-bird.ts`'s current top-level script logic into one importable, exported function
(e.g. `gradeBirdCase(runDir: string): Promise<BirdGradeResult>`) that `grade-bird.ts`'s own
`main()` calls when run as a CLI (preserves today's `npx tsx grade-bird.ts <runDir>` usage).
Update `grade-suite.ts` to `import { gradeBirdCase } from './grade-bird.js'` and call it directly
instead of `execFileSync('npx', ['tsx', GRADE_BIRD_SCRIPT, ...])` + re-reading the file it wrote.
This removes the subprocess-per-case overhead in grade-suite's batch loop and makes failures
surface as real thrown errors (caught via `captureExecError`-style handling only where actually
still needed) instead of opaque re-parsed strings. This is the one change with a small behavior
risk (removing a process boundary) — verify by running `grade-suite.ts` against an existing
suite-run directory before/after and diffing `suite-grade.json` output byte-for-byte.

### 8. Documentation-only clarification for the grade.ts/grade-bird.ts/grade-suite.ts split
Add a one-line header comment to `grade-suite.ts` and `evals/ADMIN_EVALS.md` noting it is
BIRD-specific (not a generic suite grader — the new admin/JTBD cases this PR adds don't have a
batch-grading path yet). This is a documentation fix, not a functional generalization — actually
generalizing `grade-suite.ts` to grade the admin cases too is a feature request beyond the scope
of "clean up this code," and should be called out to the PR author as a separate follow-up
rather than silently done inside a refactor PR.

## Out of scope (explicitly not touching)

- `grade.ts` — orphaned/unused by the pipeline; refactoring it has no readability payoff for
  the actually-tangled files.
- `codex.ts`'s adapter internals — structurally different from claude-code/cursor, not part of
  the confirmed duplication.
- Any of the 21 JSON eval case fixtures — pure data, not code.
- The mcp-apps-feature-flag safety-claim finding from the earlier logic review — that's a
  separate, substantive concern for the PR author to address themselves, not a refactor task.

## Rollout

1. Branch off `origin/asimantov/eval-admin-tools`.
2. Implement items 1-8 above as separate commits (one per shared module extraction, then the
   grade-bird.ts decomposition, then the grade-suite.ts subprocess→import swap, then the docs
   note) — keeps the diff easy for the PR author to review incrementally.
3. Push the branch, open a PR with base `asimantov/eval-admin-tools`, describing it as a pure
   refactor (no behavior change) responding to code-quality feedback.

## Verification

- `npx tsc` / build after each extraction commit.
- Before starting, capture a baseline: run `evals/report.ts` (or whichever scripts have
  existing sample `run.json`/`bird-result.json` fixtures/output under `evals/` or a scratch
  runs directory) and save its output.
- After the refactor, re-run the same scripts against the same inputs and diff outputs
  byte-for-byte (especially for item 7's subprocess→import change in `grade-suite.ts`, and
  item 3's stats-helper consolidation in case rounding behavior shifts).
- `npx vitest run` (confirm no existing unit tests reference the moved/renamed
  local declarations, e.g. any test importing `BirdResult` from `report.ts` or `grade-suite.ts`
  directly needs updating to import `BirdGradeResult` from the new `evals/lib/birdResult.ts`).
- Manual smoke test: run one adapter (`claude-code`) through `run-case.ts` end-to-end if a live
  Tableau server + LangSmith config is available in this environment; otherwise note in the PR
  description that this step needs the author's environment to verify.
