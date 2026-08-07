# Build or Make Named Charts with Templates — Bind First

> **Trimmed entry.** The old `inject_template_visualization` tool no longer exists, and the JSON files in `data/data-visualization-templates/` are the pre-XML node format — **not loadable** by any tool (structural reference only). Per the knowledge-layer review, this entry is reduced to the current-tools pointer; the stale JSON-walkthrough and removed-tool detail have been dropped.

- Tags: bind-first, build, make, chart, visualization-template, named-chart, simple-chart, composed-chart, waterfall, bridge, funnel, gantt, bullet, box-plot, slope, bump, control-chart, dual-axis
- Relevant user prompts/search terms: "build a chart", "make a chart", "build a waterfall chart", "make a waterfall chart", "build a bridge chart", "make a bridge chart", "build a funnel chart", "make a funnel chart", "build a gantt chart", "make a gantt chart", "build a bullet chart", "make a bullet chart", "build a box plot", "make a box plot", "build a slope chart", "make a slope chart", "build a bump chart", "make a bump chart", "build a control chart", "make a control chart", "dual axis chart", "waterfall", "bridge", "funnel", "gantt", "bullet", "box plot", "slope", "bump", "inject a template visualization", "chart type template", "JSON templates not loadable", "bind-template", "build-and-apply-worksheet", "run-dashboard-batch", "duplicate and modify instead of building from scratch", "symbol map country only"

## When to Use

Read this when you are about to build a named simple or composed chart and need to know which mechanism is current. For **any named chart type / common ask** (bar, line, scatter, treemap, waterfall/bridge, funnel, gantt, bullet, box plot, slope/bump, control, dual-axis, KPI, ranking, …) the primary move is **`bind-template` with `auto_apply: true`**: it matches the ask against the manifest `intent_keywords`, and on an exact keyword match to a `fast_path_eligible` template it binds and applies the validated template model-free (~2s). This bind-first precedence still applies when the request sounds calculation-heavy or asks how a value changes; template-owned calculations, such as a waterfall's running total, must not be authored before binding. If there is no eligible template — ambiguous ask, a hazard like sets/drilldown, or a chart type with no proven template — it escalates/proposes instead of guessing, and you build directly with the worksheet tools.

After template escalation, direct worksheet authoring is normal, not a failure. Use `add-field` to place fields on rows, columns, or encodings, then `refine-worksheet` for top-N, sorting, and other finishing steps.

## Best Practices

- **Bind first (named chart type):** `bind-template` with `auto_apply: true` for named simple or composed charts. Auto-apply only fires on templates that already passed the live-render + parity gate, so a confident bind is safe to apply.
- **Escalate to direct worksheet authoring:** when bind escalates or proposes instead of applying, use `build-and-apply-worksheet` for the whole worksheet, or stepwise `add-field` → `apply-worksheet` → `refine-worksheet` for top-N, sorting, and other finishing steps.
- **Dashboards use one bounded batch:** build focused worksheet artifacts first, then pass their ordered `artifactIds` to `run-dashboard-batch`. It derives those worksheet names from the artifacts; pass `existingWorksheetNames` only for sheets already live in the workbook. Full-profile puppet/BYOA callers may still use `compose-dashboard` or the phased dashboard tools directly.
- **Profile-conditional XML paths:** `inject-template` and `apply-workbook` exist only in full/demo profiles. Use them when the active profile exposes them; otherwise stay with the binder and direct authoring tools.

## Common Mistakes

- Searching examples first on a common chart type before trying `bind-template` with `auto_apply: true` — the binder is the faster, validated, model-free path when an eligible template exists.
- Submitting the JSON files in `data/data-visualization-templates/` to `apply-workbook` — they are the old node format and are not valid TWB XML.
- Looking for `inject_template_visualization` — it was removed; use `bind-template`, or direct worksheet/dashboard authoring when bind escalates.

## Implementation

1. Call `bind-template` with the user ask and `auto_apply: true` for every named simple or composed chart request.
2. On escalate/propose (no eligible template), build directly with `build-and-apply-worksheet`, or use `add-field` → `apply-worksheet` → `refine-worksheet` when you need stepwise control.
3. For dashboard requests, prepare worksheet artifacts, then call `run-dashboard-batch` once with their ordered `artifactIds`; add `existingWorksheetNames` only for sheets already live in the workbook. Inspect live state before any retry after a `partial` or `unknown` result; never replay the batch blindly.
4. In full/demo profiles only, browse XML templates with `list-templates` and apply a specific proven template with `inject-template`.

## Source and Confidence

- Source/evidence type: design best-practice — trimmed to a pointer on 2026-07-04 per the knowledge-layer review.
- Confidence: SME-reviewed
- Last reviewed: 2026-08-07
