# Build a Histogram with Calculation-Based Bins

When the workbook has no native bin field, derive bins from the data and use the sanctioned cached worksheet lane to preserve the bin dimension.

## Scope Check

- Primary audience: Tableau agent
- Authoring outcome improved: calculate, create, validate
- In-scope reason: Provides a proven fallback for a histogram whose bin dimension cannot be preserved by a generic template build.
- Out-of-scope risk: Bin width is data-dependent; do not copy the example width without reading the actual range.
- Tags: histogram, bins, calculated-bins, distribution, count-distinct, fixed-lod, worksheet-xml
- Relevant user prompts/search terms: "histogram", "bins", "create bins", "distribution", "bucket values", "bin width", "count entities per bin"

## When to Use

Use this when the user asks for a histogram and no native bin key is available. First try the two-call `bind-template` proposal route with the shipped distribution-histogram template.

The template's bin width is baked in (`size='283'`) and does not recompute on bind. When the bound measure's observed range makes that width inappropriate, read an existing worksheet or source summary, choose a defensible width, author a bin calculation and count measure, then build the histogram through a cached worksheet document. Do not guess a bin width or fabricate field references.

## Best Practices

- Derive bin width from observed values before authoring the calculation.
- Compute at the intended entity grain. For team totals, one proven shape is `FLOOR({FIXED [Team Name]: SUM([Goals])} / 25) * 25`.
- Count entities with `COUNTD([Team Name])`.
- Use `resolve-field` for the exact source references.
- Create or rename a worksheet scaffold, fetch it with `get-worksheet-xml` in file mode, update only the cached worksheet through `write-cached-xml`, then call `apply-worksheet`.
- Verify that both the bin dimension and count measure survive in summary data or worksheet readback.
- Reconcile the total count to the expected source entity count.

## Common Mistakes

1. Choosing a bin width without inspecting the data range.
2. Declaring success because a worksheet rendered while the bin dimension is absent.
3. Using a generic `build-and-apply-worksheet` result without checking requested field coverage. In the observed source path, the bin dimension was dropped. This product now reports dropped-field coverage, but that gate is not evidence that the generic histogram path works.
4. Assuming the distribution-histogram template's baked bin width is appropriate for every measure range.
5. Passing an arbitrary temporary path to `apply-worksheet`. Use a cache path produced by this server's worksheet tools.

## Implementation

For an entity-level Goals histogram:

1. Read an existing populated sheet with `get-summary-data` and, when needed, `get-worksheet-xml` to establish the observed range.
2. Choose a width appropriate to that range.
3. Create the calculations:

```json
[
  {
    "tool": "author-calc",
    "input": {
      "session": "<session>",
      "caption": "Goals Bin",
      "formula": "FLOOR({FIXED [Team Name]: SUM([Goals])} / 25) * 25",
      "datatype": "integer",
      "role": "dimension"
    }
  },
  {
    "tool": "author-calc",
    "input": {
      "session": "<session>",
      "caption": "Teams in Bin",
      "formula": "COUNTD([Team Name])",
      "datatype": "integer",
      "role": "measure"
    }
  }
]
```

4. Resolve the bin and count fields, create a worksheet scaffold, and fetch its cached XML.
5. Write the histogram worksheet element to that same cache file with `write-cached-xml`, preserving the scaffold worksheet name and using the resolved references.
6. Apply with `apply-worksheet`.
7. Verify with `get-summary-data` and `get-worksheet-xml`.

### What is confirmed working

- A FIXED entity-level aggregate can define equal-width calculated bins.
- `COUNTD` can provide the entity count per bin.
- A hand-authored worksheet applied through the cached XML lane can preserve the bin and count fields.

### What does not work or remains scoped

- The observed generic worksheet build dropped the bin dimension; do not use its render alone as proof.
- Use the calculation lane only when the bound measure's range makes the distribution-histogram template's baked bin width inappropriate.
- A histogram without the bin dimension in readback is not a successful result.

## Source and Confidence

- Source/evidence type: live Desktop proof, sanitized and adapted to the shipped cache boundary
- Customer-identifying and run-specific details removed: yes
- Confidence: field-tested for the calculation and worksheet route
