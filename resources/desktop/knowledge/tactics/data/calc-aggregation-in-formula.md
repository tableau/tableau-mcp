# Put Aggregation Inside Template-Bound Calculations

When a calculated measure binds cleanly but renders no marks, aggregate inside the formula instead of relying on the worksheet binding to add aggregation.

## Scope Check

- Primary audience: Tableau agent
- Authoring outcome improved: calculate, create, troubleshoot, validate
- In-scope reason: Prevents the clean-apply/zero-marks failure for conditional KPIs, deltas, ratios, and other template-bound calculated measures.
- Out-of-scope risk: This rule applies when the requested value is an aggregate; genuinely row-level calculations should remain row-level.
- Tags: calculated-field, aggregation, no-marks, blank-viz, kpi, conditional-aggregation, delta, ratio
- Relevant user prompts/search terms: "calculation has no marks", "KPI is blank", "running total", "ratio", "win rate", "latest value", "prior value", "delta", "calculated measure renders blank"

## When to Use

Use this when `author-calc`, `build-and-apply-worksheet`, or `bind-template` accepts a calculated measure, but the resulting worksheet has no marks or no summary rows.

Template-bound calculated fields use the `User` derivation. That is correct when the formula already aggregates. It is insufficient when the formula is row-level and the desired mark is an aggregate value.

## Best Practices

- Write aggregate measures as aggregate formulas. Use `SUM(IF <condition> THEN [Measure] END)`, not a bare `IF`.
- For deltas, subtract one aggregate from another.
- For ratios, divide aggregate numerators by aggregate denominators.
- Keep `User` derivation for formulas that already aggregate.
- Verify each KPI with `get-summary-data`. A clean preflight, apply, or structural readback does not prove a visible value.
- Treat a proposal-level `"derivation":"sum"` override as unproven for calculated fields; an observed bind ignored it and kept the calculation as `User`.

## Common Mistakes

1. Assuming the template binding will aggregate a row-level calculation.
2. Treating a clean apply receipt as proof that marks rendered.
3. Trying to fix a calculated field by adding `"derivation":"sum"` to the proposal.
4. Reusing a bare conditional formula after an aggregate formula succeeds.

## Implementation

Author aggregate conditional measures before placing them in KPI templates:

```json
[
  {
    "tool": "author-calc",
    "input": {
      "session": "<session>",
      "caption": "Goals at Latest Snapshot",
      "formula": "SUM(IF [Snapshot Time] = {FIXED : MAX([Snapshot Time])} THEN [Goals] END)",
      "datatype": "integer",
      "role": "measure"
    }
  },
  {
    "tool": "author-calc",
    "input": {
      "session": "<session>",
      "caption": "Goal Delta vs Prior Snapshot",
      "formula": "SUM(IF [Snapshot Time] = {FIXED : MAX([Snapshot Time])} THEN [Goals] END) - SUM(IF [Snapshot Time] = {FIXED : MAX(IF [Snapshot Time] < {FIXED : MAX([Snapshot Time])} THEN [Snapshot Time] END)} THEN [Goals] END)",
      "datatype": "integer",
      "role": "measure"
    }
  },
  {
    "tool": "build-and-apply-worksheet",
    "input": {
      "session": "<session>",
      "taskSpec": {
        "worksheetName": "KPI - Goals Latest",
        "template": "kpi-text",
        "fields": [
          "Goals at Latest Snapshot"
        ]
      }
    }
  },
  {
    "tool": "get-summary-data",
    "input": {
      "session": "<session>",
      "worksheet": "KPI - Goals Latest"
    }
  }
]
```

### What is confirmed working

- Aggregate conditional formulas render in template-bound KPI sheets.
- Aggregate-minus-aggregate works for deltas.
- Aggregate-over-aggregate works for rates and percent change.

### What does not work

- A row-level `IF ... THEN [Measure] END` calculation can bind cleanly and still render zero marks in an aggregate KPI.
- A proposal binding with `"derivation":"sum"` did not force aggregation for a calculated field in the observed path.

## Source and Confidence

- Source/evidence type: live Desktop proof, sanitized for product use
- Customer-identifying and run-specific details removed: yes
- Confidence: field-tested
