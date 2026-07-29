# Coerce a Datetime with a Template Calculation Prelude

Create a named, date-typed calculation before template binding when the request specifically needs a derived date field from a datetime.

## Scope Check

- Primary audience: Tableau agent
- Authoring outcome improved: calculate, create, validate
- In-scope reason: Provides an observed template-prelude route for a named day-grain field derived from a timestamp.
- Out-of-scope risk: This proof does not establish that direct binding of the source datetime fails.
- Tags: date, datetime, timestamp, datetrunc, date-coercion, template-binding, trend, day-grain
- Relevant user prompts/search terms: "date from timestamp", "group timestamp by day", "daily trend", "Snapshot Date", "convert datetime to date", "line chart by day"

## When to Use

Prefer a native date derivation when it directly expresses the requested grain; `expertise://tableau/tactics/data/tableau-date-handling` is the general rule. Use this calculation-prelude recipe when the user explicitly asks for a separately named derived date field, or when the template flow needs a date-typed field created from a datetime before binding.

The observed route created `Snapshot Date` as `DATETRUNC('day', [Snapshot Time])`, with datatype `date` and role `dimension`, then bound the generated calculation field to the temporal slot with day derivation.

## Best Practices

- Create the requested grain before binding the viz.
- Use `calcs` in the first `bind-template` call rather than a separate `author-calc` call when the derived date exists only for this chart.
- Apply the proposal returned by the binder. The observed proposal bound a generated calculation field ID, not the caption.
- Verify both data and structure: summary data should contain the derived field, and worksheet readback should show the intended day-level temporal shape.
- Keep the evidence scoped. A rendered worksheet alone does not prove the requested grain.

## Common Mistakes

1. Assuming the binder chose the correct date grain because the worksheet rendered.
2. Claiming direct raw-datetime binding fails. That alternative was not tested in the proof.
3. Treating the observed field-ID binding as proof that caption binding cannot work.
4. Creating a calculated date when a native derivation already meets the request and no separately named field is needed.

## Implementation

First call `bind-template` with the user's ask and this prelude:

```json
{
  "session": "<session>",
  "ask": "Build a line chart of Played by Snapshot Date, using a derived date field from Snapshot Time so the trend is grouped by day.",
  "auto_apply": true,
  "calcs": [
    {
      "caption": "Snapshot Date",
      "formula": "DATETRUNC('day', [Snapshot Time])",
      "datatype": "date",
      "role": "dimension"
    }
  ]
}
```

Then resubmit the same ask with the returned trend proposal. The observed proposal shape bound the generated calculation field to `order_date` with `"derivation":"tdy"` and the measure to `sales`.

Finally, verify with:

```json
{
  "tool": "get-summary-data",
  "input": {
    "session": "<session>",
    "worksheet": "Played by Snapshot Date"
  }
}
```

Read the worksheet with `get-worksheet-xml` when summary data alone does not expose the date function or shelf shape.

### What is confirmed working

- A `calcs` prelude can create a date-typed `DATETRUNC('day', ...)` dimension.
- The generated calculation field ID can bind to the trend template's temporal slot with day derivation.
- Summary and worksheet readback can verify the derived date and day-level shape.

### What remains unconfirmed

- Directly binding the raw datetime for the same ask was not tested; do not present it as a proven failure.
- The proof used a generated field ID and does not establish whether caption binding is equivalent for this route.

## Source and Confidence

- Source/evidence type: live Desktop proof, sanitized for product use
- Customer-identifying and run-specific details removed: yes
- Confidence: field-tested for the stated route
