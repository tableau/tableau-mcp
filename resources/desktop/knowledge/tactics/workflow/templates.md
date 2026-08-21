# Build Charts with the Current Template Paths

- Tags: bind-first, artifact-flow, chart, gantt, visualization, template, preview, multi-chart, edit-in-place, derived-metric, dashboard
- Relevant user prompts/search terms: "build a chart", "compare Sales across Categories", "show Sales over time", "show relationship between Sales and Profit", "preview charts", "build several charts", "edit this sheet", "bind-template", "run-dashboard-batch"

## When to Use

Use this entry to choose the chart-authoring path. Apply this precedence in order:

1. **Preview/no-change or open multi-chart request:** skip `bind-template`. Use `list-templates` → `list-available-fields` → `build-worksheets-from-templates`. Stop before `apply-worksheet` for preview/no-change; apply each exact `templatePlan` in order only when the user asked to write.
2. **Existing-sheet edit:** use existing-sheet tools only. Resolve the sheet, then use `add-field` and `apply-worksheet` for encoding or shelf changes, or `refine-worksheet` for top-N and sort. Do not create a replacement sheet.
3. **Unnamed derived metric:** author the calculation with `author-calc`, then use the artifact flow. A named chart that owns a calculation, such as a waterfall running total, stays binder-first.
4. **Recognizable single-view visualization:** call `bind-template` with the exact ask and `auto_apply:true`. This includes explicit chart names and common semantic asks such as “Show Sales over time.” An explicit chart name may bind immediately; a semantic ask may return one bounded proposal.

## Binder Boundary

If Call 1 proposes, make one Call 2 with one exact `call_2_contract` proposal. If Call 2 does not bind and apply, or any result escalates or blocks, stop calling `bind-template` and use the guarded artifact fallback: `list-templates` → `list-available-fields` → `build-worksheets-from-templates` → `apply-worksheet`.

A bind is terminal only with `applied:true` plus clean host verification. A fallback is terminal only with a verified `apply-worksheet` receipt whose verification passed or returned warnings. Skipped verification is nonterminal: inspect live worksheet state before any correction, and never replay an uncertain apply.

## Dashboards

Build focused worksheet artifacts first, then pass their ordered `artifactIds` to `run-dashboard-batch`. Pass `existingWorksheetNames` only for sheets already live in the workbook. Full-profile callers may use `compose-dashboard` for composition that the bounded batch cannot express.

## Common Mistakes

- Sending preview, multi-chart, or existing-sheet requests through the binder.
- Rephrasing the ask or making a third bind call after the one structured correction.
- Treating `propose`, `escalate`, `blocked`, or skipped verification as completion.
- Reusing XML-escaped field mappings in a `templatePlan`; reacquire RAW `column_ref` values with `list-available-fields`.

## Source and Confidence

- Source/evidence type: SME-reviewed authoring policy and live Studio probes.
- Confidence: SME-reviewed
- Last reviewed: 2026-08-20
