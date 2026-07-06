# Authoring migration — binder drift sync + canonical tool exemplar (Lane M2, day 2)

Migration source of truth: the source implementation (**snapshot S1**) — a read-only, local-only
snapshot workspace (git-excluded), taken 2026-07-05. It is untracked and **never** imported at build
time. Day-1 port baseline = `src/desktop/binder/` @ commit `ecc843cf`.

This document records (1) the file-by-file drift inventory, (2) the port decisions (what was brought to
parity, what was stubbed/excluded and why), and (3) the `bind-template` tool exemplar.

---

## 1. Drift inventory — `src/desktop/binder/` vs snapshot S1's `src/binder/`

Raw whitespace-insensitive `diff` line-counts are **not** used to classify drift: the snapshot uses the
source implementation's house style (double quotes, ESM `import.meta.url`), while this repo enforces single quotes + `process.cwd()`
data paths, so nearly every string line differs cosmetically. Classification below is by *behavior* /
*test-case count*, corroborated by `git status`.

### ADDED — pure library modules brought over from the snapshot (new files)

| File | Ported? | Notes |
|---|---|---|
| `calc-derivation.ts` (+ `.test.ts`, 15 cases) | ✅ ported | Pure, hermetic. `calcForcedSlotIds` now lives here; `manifest.ts` + `classify.ts` import it instead of re-declaring. |
| `memo.ts` (+ `.test.ts`, 20 cases) | ✅ ported (1 adaptation) | Content-addressed memoized binder. Source derived the schema-cache sidecar path from `fileURLToPath(import.meta.url)` (ESM-only → breaks under this repo's `type: commonjs`); adapted to `process.cwd()` to match the established packaged-data idiom (see `memo.ts` header comment). Source `console.log` benchmark line → `console.warn` (repo `no-console` allows warn/error). |
| `prewarm.ts` (+ `.test.ts`, 7 cases) | ✅ ported | Pure, hermetic shortlist prewarm. |

### CHANGED — drifted content synced to snapshot behavior

| File | Drift | Port decision |
|---|---|---|
| `manifest-types.ts` | Additive types: `RenderEvidence`, `CalcInput`, `CalcResultRole`, `DatasourceStyleSidecar`, `GoldenSpec`, first-class calc-field (H3) fields, and the `source` field used by the (OFF) sideload path. | ✅ Overwritten with snapshot types (purely additive; no existing type narrowed). |
| `classify.ts` | Stage-2b within-family tie-break + sole-wrong-matcher guard; `calcForcedSlotIds` import; propose-shortlist that *would* include `source==='local'` templates. | ✅ Synced to snapshot behavior verbatim (only imports/quotes adapted). The `source==='local'` branch is **inert** — no bundled manifest sets `source`, and no env-dir loader is ported, so the routable pool is byte-identical to eligible-only (OFF state). |
| `validate.ts` | Gate-6 `inputs`-contract handling + updated escalation messages/reasons. | ✅ Synced to snapshot behavior verbatim (imports/quotes/return-type adapted). |
| `manifest.ts` | `calcForcedSlotIds` moved to `calc-derivation.ts`; new optional `datasource_style` validation block; slug/containment hardening. | ✅ Synced. **Path resolution intentionally *not* synced**: kept the repo's `DATA_DIR = path.join(process.cwd(), 'src','desktop','data')` idiom (hermetic) instead of the snapshot's `import.meta.url`. Manifests load via the existing `loadManifests()` seam — a future provider seam can slot in behind it. |

### UNCHANGED — day-1 port already at snapshot parity (no edit needed)

`binder.ts`, `schema-summary.ts`, `field-narrowing.test.ts` (8 cases), `within-family-disambiguation.test.ts`
(9 cases) are functionally identical to the snapshot (confirmed: unmodified vs `HEAD` after sync, and all
their tests pass alongside the ported `classify.ts`/`validate.ts`).

### DEFERRED — drift NOT ported (blocked on unshippable source-implementation assets or generated artifacts)

| Snapshot file / drift | Cases | Why deferred |
|---|---|---|
| `binder.test.ts` extra cases | +6 vs repo (26→20) | Eligible-sibling / `ww-ou`-family assertions that depend on the 2 missing manifests + their golden XML. |
| `validate.test.ts` extra cases | +5 vs repo (31→26) | New gate-6 `inputs`-contract cases exercised on manifests not present in the bundled set. (The `inputs` gate itself **is** ported in `validate.ts` and is covered end-to-end by `memo.test.ts`'s calc manifest.) |
| `manifest.test.ts` | 30 (count parity) | Kept the day-1 version; the day-1 30 cases pass against the synced `manifest.ts` (incl. the new `datasource_style` block, inert for current data). |
| `ww-ou-arrow.manifest.json`, `ww-ou-diff.manifest.json` | 2 data files | Adding them requires regenerating the **generated** `template-manifests.index.json` + `template-manifests.fixture.json` (AGENTS.md: generated — fix the generator, don't hand-edit) and would need `ww-ou` golden render XML. `manifest.test.ts` couples every manifest's `fixture_bind` stamp to `fixture.json` fields and requires a live `render_verified` stamp, so a partial add would fail existing (un-weakenable) tests. Repo bundles **15** manifests + index + fixture — sufficient for the binder + tool. |
| `ww-ou-fidelity.test.ts` (10), `ww-floating-bars-fidelity.test.ts` (6), `control-chart-xmr-fidelity.test.ts` (6), `golden-parity.test.ts` (16), `compile-checkpoint-template.test.ts` (21), `datasource-style-splice.test.ts` (7), `calc-slots-contract.test.ts` (5) | 71 cases | Golden/fidelity suites that read live-render golden assets (the `<local golden-corpus root>` corpus) which **never ship here**. Out of scope per the task. |
| `worksheet-analyzer.test.ts` (15) | 15 cases | Its source module `worksheet-analyzer.ts` is **not present in snapshot S1** — cannot port the test without the implementation; out of scope. |
| `local-sideload.test.ts` (10) | 10 cases | The source's local-template-dir env-dir sideload + stamp-trust feature. Only the **OFF** state is ported (see below); the ON-state tests are excluded. |

### Source-environment assumptions that were adapted or excluded (never ship here)

- **`import.meta.url` data paths** → adapted to `process.cwd()` in `memo.ts` (matching `manifest.ts`'s
  existing idiom). No runtime `import.meta` usage remains in the binder (the 4 grep hits are explanatory
  comments only).
- **Local-template-dir sideload + stamp-trust** (the source's env-dir feature) → **OFF state only**. No `process.env` read
  exists anywhere in `src/desktop/binder/` (grep-proven), so with the env unset behavior is byte-identical
  to the snapshot. The `source` field + `source==='local'` branch remain in the types/classifier but are
  inert (no loader, no manifest sets `source`). The feature is effectively stubbed out; `local-sideload.test.ts`
  is excluded.
- **`<local golden-corpus root>` golden corpus** → never referenced (grep-proven). All golden/fidelity suites deferred.

---

## 2. Manifest bundling

Day-1 already bundled `src/desktop/data/template-manifests/` (15 `*.manifest.json`) plus the generated
`template-manifests.index.json` and `template-manifests.fixture.json`. The binder loads them via
`loadManifests()` (`manifest.ts:591`) from the **package** path `process.cwd()/src/desktop/data/...`
(`manifest.ts:36`) — never a user path. Bundling is the current freshness answer; a provider seam can slot
in behind `loadManifests()` without touching callers. No new manifest data was added (see DEFERRED above).

---

## 3. Canonical tool exemplar — `bind-template`

Behavior reference: snapshot S1's `src/server/tools/binder.ts` (`tableau-bind-template`). Shape conforms to
this repo's #347/#370 Desktop-tool pattern — **not** copied verbatim (source uses `_session`, `ctx.log`,
emoji text, hand-built `isError`).

**Files**

- `src/tools/desktop/binder/bindTemplate.ts` — factory `getBindTemplateTool(server)` (`:130`), zod
  `paramsSchema` (`:48`), `logAndExecute` funnel (`:151`).
- `src/tools/desktop/binder/bindTemplate.test.ts` — 7 colocated cases, mocked executor + mocked binder core
  (`Provider.from(tool.callback)` + `getMockRequestHandlerExtra()`).
- Registered in `src/tools/desktop/toolName.ts` (`'bind-template'`) and `src/tools/desktop/tools.ts`
  (`getBindTemplateTool` in `desktopToolFactories`). Registration is auto-covered by the data-driven
  `src/server.desktop.test.ts` and `src/tools/toolName.test.ts`.

**Adapter flow** (thin — no new command layer): `extra.getExecutor(session)` → reuse existing
`getWorkbookXml` command (`bindTemplate.ts:156`) → `loadManifests()` (`:161`) → pure `bindTemplate(...)`
(`:162`) → `Ok({ ...binderResult, guidance })`. A pure reference-library + passthrough tool legitimately has
no new command layer (AGENTS.md); the only Agent-API call reuses the existing `get-workbook-xml` command.

**Two-call protocol** (server is model-free): Call 1 `{ session, ask }` → `bound` | `propose`; Call 2
`{ session, ask, proposal }` → `bound` | `escalate`.

**Key adaptations vs the source implementation**

- Top-level params are camelCase (`session`, `ask`, `proposal`, `minConfidence`) — no `_session`, no
  `min_confidence`. The **nested `proposal`** mirrors the binder library's public `BindingProposal` /
  `PROPOSAL_OUTPUT_SCHEMA` contract verbatim (incl. `bindings[].slot_id`) so a Call-1 `propose` payload
  round-trips into a Call-2 `proposal` unchanged — this is a serialized library data contract, not
  tool-ergonomics naming.
- `escalate` is returned as a **normal `Ok` outcome** (with plain-text `guidance`), **not** `isError: true`.
  the source set `isError` for escalate; this repo reserves `CallToolResult.isError` for the `McpToolError` funnel.
  Only a workbook-read failure or a thrown exception funnels through `DesktopCommandExecutionError` /
  `logAndExecute`'s catch (→ `isError: true`).
- No emoji in any tool string (AGENTS.md ban). Escalation `guidance` routes by reason and references only
  tools that exist in this repo (`resolve-field`); it speaks generically for tier-2 rather than naming
  source-only tools.

---

## 4. Acceptance

- `scripts/agent-check` → **ALL GREEN (3 checks)**: `npm run lint`, `npx tsc --noEmit`,
  `npx vitest run --config ./vitest.config.ts` = **2052 tests / 155 files** passed.
- Binder library: **141 tests / 8 files** pass (incl. ported `calc-derivation`, `memo`, `prewarm`).
- Hermeticity: grepping `src/desktop/binder` + `src/tools/desktop` for the `<local golden-corpus root>` path (and `homedir`) → **no matches**.
  No `process.env` reads in the binder. `import.meta` appears only in explanatory comments; the
  local-sideload env var is not referenced anywhere (no runtime read, and its name is not recorded).
- Pre-existing lint debt (unrelated to this migration, unmodified vs `HEAD`):
  `getDashboardXml.test.ts` and `lookupWorkbookSchema.test.ts` had committed prettier violations that made
  the baseline `agent-check` red. Fixed with `prettier --write` (formatting only — trailing commas +
  line-wrapping; zero logic/assertion change). `eslint.config.mjs` now ignores the migration snapshot workspace.

---

## 5. Residual risk & day-3

- **Manifest data drift (highest priority).** Sync `ww-ou-arrow` + `ww-ou-diff` manifests, then regenerate
  `template-manifests.index.json` + `template-manifests.fixture.json` via the source generator (do not
  hand-edit generated files), and either bring the `ww-ou` golden XML or explicitly drop the golden/fidelity
  suites for this package. Only then can `binder.test.ts` (+6) and `validate.test.ts` (+5) reach snapshot
  parity without weakening tests.
- **Golden/fidelity suites** (`ww-ou`, `ww-floating-bars`, `control-chart-xmr`, `golden-parity`,
  `compile-checkpoint`, `datasource-style-splice`) depend on the `<local golden-corpus root>` corpus and are out of
  scope until a shippable, hermetic fixture strategy exists.
- **`worksheet-analyzer`**: source not in the snapshot — obtain the implementation before porting its test.
- **Local-sideload feature**: currently OFF-state-only (types present, no loader). A hermetic design (bundled
  vs provider seam) is being handled separately; do not wire the source's local-template-dir env var here.
- **`datasource_style` validation** is ported but inert (no bundled manifest uses it) — exercised only once
  data lands.

---

## 5b. Bind-pipeline security hardening — new in this port (Lane M10)

An adversarial security review of the bind output pipeline landed four fail-closed
hardenings that are **new in this port and not present in the source implementation** — they
are additive safety, not a sync:

- **XML output escaping.** `bindTemplate` returns a `title`, `template_parameters.DATASOURCE`,
  and `field_mapping` values that the apply instruction tells the consumer to substitute
  verbatim into template XML attributes. A new `escapeXml` utility (`src/desktop/binder/escape.ts`)
  escapes the five XML metacharacters exactly once at production (field values + datasource in
  `validate.ts` gate 7; title in `binder.ts`), so a workbook- or proposal-controlled value can no
  longer break out of the attribute and inject XML structure. Tableau field-reference brackets are
  intentionally left intact, so clean names round-trip byte-identical. The apply instruction now
  documents the "escaped once — do not double-escape" contract.
- **Title control-char rejection.** The shared proposal schema now rejects C0 control
  characters and DEL in `title` (illegal in XML 1.0 even when escaped), and the no-LLM title
  generator strips them, from one shared definition so the tool boundary and library agree.
- **Field-count cap.** No-LLM classification runs one regex per schema field; a pathological
  wide schema is a per-call CPU DoS. A named cap (`MAX_CLASSIFIABLE_FIELDS`) makes the classifier
  fail closed (never a truncated subset) and escalate a new `schema-too-large` reason instead.
- **Loud dev-fallback.** Resolving binder data to the cwd-relative dev fallback now emits a
  one-line warning (resolution order unchanged) so a broken/partial packaged install is no longer
  silent about serving cwd-relative content.

These changes touch only the ported binder library + its tools; none depends on unshippable source
assets, so all four are covered by colocated unit tests in this package.

## 6. Rebase verification (pre-push, day-7)

This lane's changes must be rebased by the orchestrator (git operations are out of scope for the
implementing agent — **no rebase was performed here**). After the rebase onto the long-lived migration
base, verify:

- **Provider seam is intact.** `bind-template` now sources manifests through
  `bundledIntelligenceProvider.listTemplateManifests()` (like propose/validate/list), not raw
  `loadManifests()`. Confirm `src/desktop/intelligence/provider.ts` still exports
  `listTemplateManifests()` returning exactly `[...loadManifests().values()]` (manifests keyed by
  `manifest.template`). If a milestone-2 provider landed on the base, re-confirm the re-keyed Map stays
  byte-identical; the seam test (`bindTemplate.test.ts` › "provider seam") is the guard.
- **No shared-registry drift.** This lane did **not** touch the coordinated files
  (`src/tools/desktop/toolName.ts`, `tools.ts`, `src/errors/mcpToolError.ts`,
  `src/server.desktop.test.ts`). The rebase should confirm they are unchanged by this lane and resolve any
  incoming edits from the active author cleanly.
- **Public-hygiene scrub holds.** Re-run the tracked-file provenance scan after rebase over the marker set
  used by this lane (the source repo's short name/full name, its migration branch name, its snapshot commit
  SHA, `/Users/…` home paths, and maintainer personal names) via
  `git ls-files -z | xargs -0 grep -niE '<markers>'`, and confirm the **only** remaining hit is the
  sanctioned functional ignore entry for the local migration-snapshot dir (git-excluded) in `eslint.config.mjs`. Incoming commits must not
  reintroduce repo/branch/SHA or personal-name provenance.
- **Local ignore still needed.** Confirm the local, git-excluded snapshot workspace still exists; if the
  base branch dropped it, remove the now-dead ignore entry for the local migration-snapshot dir (git-excluded) too.
- **Green gate.** Re-run `scripts/agent-check` (lint + `tsc --noEmit` + `vitest run`) post-rebase; the four
  binder tools (`bind-template`, `propose-template`, `validate-proposal`, `list-templates`) must all pass.
