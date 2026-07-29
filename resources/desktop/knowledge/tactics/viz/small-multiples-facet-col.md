# Build Small Multiples with the facet_col Slot

Use the trend template's optional `facet_col` slot to create side-by-side line-chart panes without manually composing shelves.

## Scope Check

- Primary audience: Tableau agent
- Authoring outcome improved: create, compose, validate
- In-scope reason: Provides the proven template route for a faceted line chart.
- Out-of-scope risk: The proof observed pane structure, not summary values or pixel-level rendering.
- Tags: small-multiples, faceting, facet-col, side-by-side, line-chart, panes, trend
- Relevant user prompts/search terms: "small multiples", "side by side", "faceted line chart", "one panel per group", "trellis", "compare trends by category"

## When to Use

Use this when one dimension should create side-by-side panes while a measure remains a time series. The trend-line template exposes an optional `facet_col` slot, so the facet can be bound without manual shelf crossing.

Use `expertise://tableau/tactics/viz/viz-in-tooltip` instead when the finer-grain dimension belongs only in hover detail rather than visible panes.

## Best Practices

- Check template slots before reaching for manual worksheet composition.
- Bind the temporal field to `order_date`, the measure to `sales`, and the pane dimension to `facet_col`.
- Include the required temporal derivation for a datetime field; the observed route used `"derivation":"tdy"`.
- Follow the two-call `bind-template` protocol: send the ask verbatim, then resubmit it with the proposal and `target_worksheet`.
- Let the template create the worksheet and shelves. Do not use `add-field` merely to place the facet.
- If the structure is correct but the mark remains Automatic, use the cached XML lane for the smallest possible change from Automatic to Line.
- Verify the pane count and shelf shape with `get-worksheet-xml`. Do not borrow numeric evidence from another worksheet.

## Common Mistakes

1. Assuming small multiples require hand-authored shelf crossing before checking `facet_col`.
2. Omitting the date derivation and producing a collapsed temporal series.
3. Using `add-field` only to place the facet dimension.
4. Claiming values were verified when the observed verification only established pane and XML structure.
5. Rewriting the entire worksheet when only the mark class needs correction.

## Implementation

```json
[
  {
    "tool": "bind-template",
    "input": {
      "session": "<session>",
      "ask": "Build a small-multiples line chart showing Goals over Snapshot Time, faceted side-by-side by Group Name.",
      "auto_apply": true
    }
  },
  {
    "tool": "bind-template",
    "input": {
      "session": "<session>",
      "ask": "Build a small-multiples line chart showing Goals over Snapshot Time, faceted side-by-side by Group Name.",
      "auto_apply": true,
      "target_worksheet": "Goals over Snapshot Time by Group",
      "proposal": {
        "template": "trend-line-chart",
        "title": "Goals over Snapshot Time by Group",
        "confidence": 0.9,
        "bindings": [
          {
            "slot_id": "order_date",
            "field": "Snapshot Time",
            "derivation": "tdy"
          },
          {
            "slot_id": "sales",
            "field": "Goals"
          },
          {
            "slot_id": "facet_col",
            "field": "Group Name"
          }
        ]
      }
    }
  }
]
```

The observed structural readback had a Line mark, Goals on Rows, and Group Name crossed with day-grain Snapshot Time on Columns. If readback shows Automatic when Line is required:

1. Call `get-worksheet-xml` with `"mode":"file"`.
2. Read and replace only the mark-class element.
3. Save the replacement through `write-cached-xml`.
4. Apply with `apply-worksheet`.
5. Read the worksheet back again.

### What is confirmed working

- `facet_col` on the trend template creates visible side-by-side panes.
- The successful proposal used day-grain Snapshot Time, Goals, and Group Name.
- A minimal cached XML touch-up can change Automatic to Line.
- The observed readback confirmed a 12-pane structure and the expected shelf crossing.

### What does not work or remains unobserved

- Manual shelf crossing is unnecessary for this proven route.
- The proof did not record values for the final faceted worksheet; do not claim numeric verification.
- XML structure does not prove pixel-level rendering beyond what the readback can observe.

## Source and Confidence

- Source/evidence type: live Desktop proof, sanitized for product use
- Customer-identifying and run-specific details removed: yes
- Confidence: field-tested for structure
