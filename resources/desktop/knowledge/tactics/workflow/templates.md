# Visualization Templates — Current-Tools Pointer

> **Trimmed entry.** The old `inject_template_visualization` tool no longer exists, and the JSON files in `data/data-visualization-templates/` are the pre-XML node format — **not loadable** by any tool (structural reference only). Per the knowledge-layer review, this entry is reduced to the current-tools pointer; the stale JSON-walkthrough and removed-tool detail have been dropped.

- Relevant user prompts/search terms: "inject a template visualization", "chart type template", "JSON templates not loadable", "tableau-bind-template", "tableau-search-examples", "duplicate and modify instead of building from scratch"

## When to Use

Read this when you are about to build a worksheet from a "template" and need to know which mechanism is current. For a **known chart type / common ask** (bar, line, scatter, treemap, waterfall, KPI, ranking, …) the primary move is **`tableau-bind-template`**: it matches the ask against the manifest `intent_keywords`, and on an exact keyword match to a `fast_path_eligible` template it returns validated inject args model-free (~2s). If there is no eligible template — ambiguous ask, a hazard like sets/drilldown, or a chart type with no proven template — it escalates/proposes instead of guessing, and you fall back to search + duplicate-and-modify.

## Best Practices

- **Bind first (known chart type):** `tableau-bind-template(ask="ranked bar of sales by sub-category")`. On a confident bind, apply the returned template via `tableau-inject-template` and adapt fields/formatting. Auto-bind only fires on templates that already passed the live-render + parity gate, so a confident bind is safe to apply.
- **Fall back to search (no eligible template):** `tableau-search-examples(query="bar chart sorted by measure")` returns native `.twb` XML fragments you can adapt directly — no JSON→XML conversion needed.
- **Duplicate-and-modify:** call `tableau-get-workbook`, deep-clone a similar existing `<worksheet>`, patch only the mark type / shelf fields / encodings, append a matching `<window>`, then `tableau-apply-workbook`. Use this when neither bind nor search yields a usable start.
- **XML templates:** `tableau-list-templates` (now annotated with `[fast-path]` + a short description) and `tableau-inject-template` load XML templates from `data/data-visualization-templates-xml/` (not the legacy JSON set).

## Common Mistakes

- Reaching for `tableau-search-examples` on a common chart type before trying `tableau-bind-template` — the binder is the faster, validated, model-free path when an eligible template exists.
- Submitting the JSON files in `data/data-visualization-templates/` to `tableau-apply-workbook` — they are the old node format and are not valid TWB XML.
- Looking for `inject_template_visualization` — it was removed; use `tableau-bind-template` → `tableau-inject-template` (XML templates), or `tableau-search-examples` when no template matches.

## Implementation

1. `tableau-bind-template` with the user ask. On a confident bind, `tableau-inject-template` the chosen template and adapt fields.
2. On escalate/propose (no eligible template), `tableau-search-examples` for the chart you need and adapt the returned XML directly.
3. If nothing matches, `tableau-get-workbook` and duplicate-and-modify an existing worksheet.
4. To browse what exists, `tableau-list-templates` (shows which slugs are fast-path-eligible); inject a specific one with `tableau-inject-template`.

## Source and Confidence

- Source/evidence type: design best-practice — trimmed to a pointer on 2026-07-04 per the knowledge-layer review.
- Confidence: SME-reviewed
- Last reviewed: 2026-07-04
