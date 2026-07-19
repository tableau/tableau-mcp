# NotionalSpec Authoring Loop

Use NotionalSpec when the right abstraction is a semantic chart request, not workbook XML. This module covers the native Tableau command pair that generates a worksheet from a compact semantic spec — the fastest, safest authoring path for every chart family in the v0.2 enum.

**Failure recovery companion:** when this loop errors, lands wrong, or the workbook changes underneath you, see `../workflow/notional-spec-recovery.md` before falling back or retrying.

Verification status: LIVE-VERIFIED on Tableau Desktop (main, 2026-07-19) via `execute-tableau-command`: `bar`, `line`, `filledmap`, `treemap`, `scatterplot`, `pie`, descending sort, top-N categorical filter, color/size/detail encodings, dashboard assembly alongside `new-dashboard`/`add-sheet-to-dashboard`. Per-command wall time 37–120 ms.

---

## Scope Check

- Primary audience: Tableau agent / semantic viz authoring
- Authoring outcome improved: create, refine, troubleshoot
- In-scope reason: Uses Tableau's native NotionalSpec loop for worksheet-level viz generation.
- Out-of-scope risk: NotionalSpec does not cover dashboards/layout, reference lines, annotations, or calculated-field creation (see the calc-authoring companion).
- Tags: notional-spec, semantic-viz, generate-viz, fast-path, filters, sort, chart-type
- Relevant user prompts/search terms: "make a quick chart", "sales by region as a bar", "refine this chart", "top 5", "last 3 months", "semantic viz loop"

## When to Use

FIRST CHOICE for any plain or analytic chart request whose chart family is in the v0.2 enum. Prefer this loop over workbook-XML authoring every time it can express the ask.

- Create a standard worksheet from a compact semantic description.
- Refine an existing agent-authored worksheet by editing its spec and regenerating.
- Avoid hand-authoring XML for chart families, field encodings, filters, and basic sort.

Command (via `execute-tableau-command`):

- `tabdoc:generate-viz-from-notional-spec`
  - Input: `NotionalSpecJson` string.
  - Optional `ClearSheet` boolean.
  - Do NOT pass `WorksheetId` (observed 500). Target the sheet with `tabdoc:goto-sheet` first; the command renders on the current worksheet.
- `tabdoc:generate-notional-spec-from-viz` exists (reads current viz into a spec) but is WRITE-BLIND over the generic External API route — it reports `SUCCEEDED` with no payload. Until a payload-bearing channel ships, track the spec you authored in conversation instead of reading it back.

## Best Practices

- **Default to v0.2**: `"version": "0.2.0"` at top level (full three-part string).
- **The spec is authoritative, not a patch** (live-verified 2026-07-19): every `generate-viz-from-notional-spec` call lays out the current sheet from the spec you send. A partial spec REPLACES the sheet with just that partial content — `ClearSheet:false` does NOT merge. To refine, edit the FULL previous spec and resend it.
- **Refinement = remember → edit → regenerate**: keep the last spec you applied per sheet in conversation state; apply user refinements ("top 5, sorted") as edits to that full spec; regenerate on the same sheet.
- **Commands apply asynchronously after `SUCCEEDED`**: the op result means dispatched, not landed. After `new-worksheet`/`new-dashboard`, poll `list-worksheets`/`list-dashboards` until the new item appears (250 ms interval works) before generating. After `goto-sheet`, settle ~1 s before applying, or the spec can land on the previous sheet.
- **Respect the param contract**: wrong or missing parameters do not fail silently — Tableau pops a modal error dialog on the USER'S screen ("Unable to complete action … missing: <param>"), and an open modal can fail subsequent commands. Validate command names and required params before invoking.
- **Coherence result is structural only**: the product's coherence check compares field metadata and chart type (booleans at the wire). It never validates computed values. Never present a number as verified because generation succeeded.
- **No in-loop readback verifies a sort or top-N landed** (accepted blind spot, filed by the first Sonnet audition 2026-07-19): generation reporting `SUCCEEDED` proves dispatch, not ordering. To assert "sorted best-first" or "top 5 only" as fact, read `GET /v0/workbook/document` and look for the concrete nodes (live-verified 2026-07-19): a spec `sort` lands as `<computed-sort column='…[none:Dim:nk]' direction='DESC' using='…[sum:Measure:qk]'/>` (NOT a `<sort>` element), and a top-N limit as `<filter class='categorical'>` wrapping `<groupfilter function='end' count='N' end='top'>`. Otherwise state the intent ("sorted best-first"), never a data outcome ("West leads").
- **Stay inside the enum**: if the requested chart is outside the v0.2 chart enum, fall back to XML authoring rather than inventing a chart value.

## Common Mistakes

1. **Treating `ClearSheet:false` as "preserve and add"**: it does not merge. Sending a spec with only the new field wipes the rest of the sheet. Send the full edited spec.
2. **Passing `WorksheetId`**: observed 500. Use `goto-sheet` + current-sheet default.
   **The spec renders on the ACTIVE sheet — always `goto-sheet` your target IMMEDIATELY before `generate-viz-from-notional-spec` and re-verify which sheet is active if any call ran in between.** Skipping this clobbered a neighboring sheet live (2026-07-19): the spec silently replaced the still-active previous sheet's content, and the agent spent its whole turn restoring it.
3. **Reading state immediately after dispatch**: `SUCCEEDED` returns before the app applies. Poll the list tools; don't trust one blind sleep.
4. **Expecting `generate-notional-spec-from-viz` output**: write-blind over the generic route; no payload comes back.
5. **Using NotionalSpec for dashboards**: assemble dashboards with `new-dashboard` + `add-sheet-to-dashboard` (both live-verified); the spec covers one worksheet.
6. **Authoring calculations through NotionalSpec**: the schema cannot express calculated fields, LODs, or table-calc addressing. Use the whole-document round-trip (see `notional-spec-calc-authoring.md`), then reference the calc by caption in a spec field.
7. **Refining a sheet holding content the spec can't model** (reference lines, annotations): regeneration clobbers what the schema can't represent. Warn before regenerating such sheets.

## Implementation

### NotionalSpec v0.2 shape

Top-level required: `version`, `fields`. Optional: `chart`, `relativeDateFilters`, `dateRangeFilters`, `rangeFilters`, `categoricalFilters`, `sort`.

Each `fields` entry is a `FieldInstance` with required `caption` plus:

| Property | Allowed values / notes |
|---|---|
| `data` | `number`, `string`, `date`, `boolean`, `geographic`, `set` |
| `type` | `discrete`, `continuous` |
| `role` | `dimension`, `measure` |
| `aggregation` | `default`, `count`, `countd`, `sum`, `avg`, `max`, `min`, `median`, `year`, `qtr`, `month`, `week`, `day`, `hour`, `minute`, `second` |
| `encoding` | `color`, `size`, `text`, `shape`, `x`, `y`, `detail` |
| `fieldIdentifier` | Stable field identifier when available |

v0.2 `chart` enum:

```json
["text", "heatmap", "bar", "stackedbar", "line", "area", "gantt",
 "scatterplot", "histogram", "symbolmap", "filledmap", "treemap",
 "pie", "dualline", "boxplot", "bullet", "bubble"]
```

`sort` requires `by` — the CAPTION of the field whose values order the sort (usually the measure); `field` is the caption of the field being sorted (the dimension). Optional `aggregation` applies to the `by` field; `direction` is `asc`/`desc`.

Categorical filters require `type` and `field`; they may include `values`, `exclude`, `limit` (`{ "type": "top"|"bottom", "limit": n, "field", "aggregation" }`), and `condition` (`{ "operator", "value", "field", "aggregation" }`).

Relative date filters require `type` (`"relative-date"`), `field`, `amount`, `period` (**plural**: `days` … `years`), `direction` (`next`/`previous` — "last 3 months" is `"previous"`; there is NO `last` literal).

### Example 1: minimal bar, sorted best-first (live-verified)

```json
{
  "version": "0.2.0",
  "chart": "bar",
  "fields": [
    { "caption": "Region", "data": "string", "type": "discrete",
      "role": "dimension", "encoding": "x" },
    { "caption": "Sales", "data": "number", "type": "continuous",
      "role": "measure", "aggregation": "sum", "encoding": "y" }
  ],
  "sort": { "field": "Region", "by": "Sales",
            "aggregation": "sum", "direction": "desc" }
}
```

### Example 2: top-5 refinement (live-verified pattern)

The user asks "just the top 5, best first" about the Example 1 sheet. Take the FULL previous spec, add the sort (already present) and the limit, resend on the same sheet:

```json
{
  "version": "0.2.0",
  "chart": "bar",
  "fields": [
    { "caption": "Region", "data": "string", "type": "discrete",
      "role": "dimension", "encoding": "x" },
    { "caption": "Sales", "data": "number", "type": "continuous",
      "role": "measure", "aggregation": "sum", "encoding": "y" }
  ],
  "sort": { "field": "Region", "by": "Sales",
            "aggregation": "sum", "direction": "desc" },
  "categoricalFilters": [
    { "type": "categorical", "field": "Region",
      "limit": { "type": "top", "limit": 5,
                 "field": "Sales", "aggregation": "sum" } }
  ]
}
```

Sending ONLY the `sort`/`categoricalFilters` fragment would blank the chart — the spec is the whole worksheet contract.

### Example 3: treemap with dual encoding (live-verified)

```json
{
  "version": "0.2.0",
  "chart": "treemap",
  "fields": [
    { "caption": "Sub-Category", "data": "string", "type": "discrete",
      "role": "dimension" },
    { "caption": "Sales", "data": "number", "type": "continuous",
      "role": "measure", "aggregation": "sum", "encoding": "size" },
    { "caption": "Profit", "data": "number", "type": "continuous",
      "role": "measure", "aggregation": "sum", "encoding": "color" }
  ]
}
```

### What does NOT work

- Reference lines, annotations.
- Calculated-field creation (companion doc covers the working path).
- Dashboards, zones, layout.
- `WorksheetId` parameter (500).
- Reading spec/coherence payloads back over the generic route (write-blind).
- Chart families outside the v0.2 enum; v0.3-only vocabulary (tooltip encodings, minutes/hours periods, `barside`, `dualbarline`) unless the V3 flag is on (default OFF).

## Source and Confidence

- Source/evidence type: live execution on Tableau Desktop (main) via External API + Tableau codegen schema review
- Source: live probe battery 2026-07-19 (charts, sort, top-N, replace semantics, async-apply races, write-blind readback, param-error modals); NotionalSpec command/schema packet
- Customer-identifying details removed: yes
- Confidence: live-verified for everything marked live-verified above; schema-verified otherwise
- Last reviewed: 2026-07-19
