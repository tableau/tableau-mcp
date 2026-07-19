# Calculated Fields for the Semantic Loop (Whole-Document Round-Trip)

**Dynamic-dashboard companion:** `notional-spec-dynamic-authoring.md` — the router for the full author-* verb set (sets, parameters, actions, formatting) and the key-signature/melody law. This doc is the calc detail within it.

The NotionalSpec schema cannot express calculated fields — but calcs are how analytic asks (running totals, moving averages, ratios, rank) become chartable. This module covers the ONE working path for authoring calcs on the semantic loop: the whole-workbook-document round-trip, live-proven with Workout-Wednesday-grade window calcs (2026-07-19, 12 calcs in one splice, no dialogs, no Cloud sign-in).

---

## Scope Check

- Primary audience: Tableau agent / semantic viz authoring
- Authoring outcome improved: calculate, create, refine
- In-scope reason: Documents the document read/edit/write pair that lands calculated fields for NotionalSpec charts to reference.
- Out-of-scope risk: This is whole-document replacement, not node surgery — it carries every rule from `calc-fields.md` for the column XML it splices.
- Tags: calculated-fields, notional-spec, semantic-viz, window-calcs, document-roundtrip
- Relevant user prompts/search terms: "running total", "moving average", "profit ratio", "year over year", "rank", "add a calculated field then chart it"

## When to Use

**If the `author-calc` tool is available, use it first** — it takes `caption` + `formula` primitives and performs this whole round-trip internally (splice, load, readback-verify), so no document ever passes through your hands. Fall back to the manual round-trip below only when `author-calc` is absent or you need a multi-column batch splice.

Use the document round-trip when an ask needs a field that doesn't exist yet — then chart it with the NotionalSpec loop:

1. `tabui:save-underlying-metadata` → returns the full workbook document (routed to GET `/v0/workbook/document`).
2. Splice `<column>` calc nodes into the target `<datasource>` (obey every rule in `calc-fields.md`: `[Calculation_<digits>]` naming with exactly one underscore, internal-name references, dependency columns).
3. `tabui:load-underlying-metadata` with the edited document as `text` (routed to POST `/v0/workbook/document`).
4. Reference the calc by its CAPTION in a NotionalSpec `fields` entry and generate the chart.

This is the one blessed use of XML on the semantic loop: whole-document, the way the External API intends — never node-level surgery against a live sheet.

## Best Practices

- **Prefer this over the calculation-dialog commands**: `apply-calculation-for-create-or-update` and friends are Analytics-Assistant-gated (require a signed-in Cloud+AI session) and observed failing 400/500 without it. The document round-trip needs no sign-in and opens no dialog.
- **Whole document in, whole document out**: read fresh, edit, write back promptly. Do not cache a document across user edits — re-read before each splice.
- **The POST is your validity gate — but VERIFY BY READBACK**: Tableau's parser validates the document on load and rejects malformed calc XML with actionable error text. A clean load means the calc parsed — it does NOT mean the numbers are right, and a `completed` envelope does not by itself prove the change APPLIED (see the column-removal no-op below). After every load, re-read with `tabui:save-underlying-metadata` and confirm your change is present before building on it.
- **Numbers are unverified until verified** (non-negotiable): generation success and coherence checks never validate values. Plain aggregates (SUM/AVG of a physical column) are Tableau's own math and trustworthy; window calcs, rank, and anything with Compute-Using/addressing can render beautifully wrong. Verify against an independent computation before presenting a number as fact — or present the chart while saying the values are unverified.
- **Close dialogs first**: an open calculation-editor (or any modal) can fail subsequent applies with 500s. If applies start failing after a user interaction, ask the user to close open dialogs before retrying.
- **Keep the user's tree sacred**: splice adds your calc columns; never drop or rewrite nodes you didn't author.

## Common Mistakes

1. **Reaching for `apply-calculation-for-create-or-update`**: AA/Cloud-gated; fails without sign-in. Use the document round-trip.
2. **Trying to express the calc inside NotionalSpec JSON**: the schema has no calc vocabulary (its FieldInstance has no formula slot). Splice first, then reference by caption.
3. **Violating `calc-fields.md` naming**: a second underscore in `[Calculation_<digits>]` passes the parser but flags the field invalid in the Data pane.
4. **Referencing captions in formulas**: formulas resolve internal `name` attributes, not captions (Superstore's name==caption is a coincidence, not a rule).
5. **Treating a rendered window calc as correct**: RANK or YoY with wrong addressing draws a plausible chart with silently wrong math. Rendered ≠ right.
6. **Node-level XML surgery on a live workbook**: the legacy failure mode this loop exists to replace. Whole-document or nothing.

## Implementation

### Recipe: running total the challenge-legal way

Read the document, then splice into the data datasource (formula fields per `calc-fields.md`):

```xml
<column name='[Calculation_1737264000001]' role='measure' type='quantitative'
        datatype='real' caption='Running Total Sales'>
  <calculation class='tableau' formula='RUNNING_SUM(SUM([Sales]))' />
</column>
```

Write the whole edited document back via `tabui:load-underlying-metadata` (`text` = the full XML). Then chart it semantically:

```json
{
  "version": "0.2.0",
  "chart": "line",
  "fields": [
    { "caption": "Order Date", "data": "date", "type": "discrete",
      "role": "dimension", "aggregation": "month", "encoding": "x" },
    { "caption": "Running Total Sales", "data": "number", "type": "continuous",
      "role": "measure", "aggregation": "sum", "encoding": "y" }
  ]
}
```

### What does NOT work

- `apply-calculation-for-create-or-update` without a Cloud+AI session (400/500).
- `tabdoc:open-calc-editor-with-custom-calc` as a headless calc door: it returns `completed` but does NOT commit the calc — it opens the calculation editor with the formula pre-filled, and the open editor holds the UI thread so subsequent commands fail until a human closes it (live-proven 2026-07-19, twice). Human-in-the-loop only; never call it in an unattended run.
- Raw `tabdoc:`/`tabui:save-underlying-metadata` over the External API command route (`command-not-found` 404) — these verb names are THIS server's mapping to the document endpoints, not registered app commands.
- Expressing formulas, LODs, or table-calc addressing inside NotionalSpec JSON.
- Any claim that a spliced calc's VALUES are correct because the load succeeded or a chart rendered.
- **REMOVING a datasource `<column>` via document load: silently ignored** (live-proven 2026-07-19, Desktop main.26.0715): the load reports `completed` but the column survives — column adds and worksheet-content rewrites apply; column deletes no-op. Do not "clean up" calcs by round-trip; the readback will show them still there.

## Source and Confidence

- Source/evidence type: live execution on Tableau Desktop (main) via External API
- Source: 2026-07-19 live sessions — 12-calc splice with window functions parsed and charted (WW2025-W1); AA-gated dialog path failures; raw-route 404s for the metadata verb names; executor mapping in `src/desktop/externalApi/externalApiToolExecutor.ts`
- Customer-identifying details removed: yes
- Confidence: live-verified mechanism; per-calc numerical correctness explicitly NOT covered (verify values independently)
- Last reviewed: 2026-07-19
