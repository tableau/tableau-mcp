# Bind a Template to a Derived Metric

Create a derived metric in the `bind-template` calculation prelude, then bind that calculation by caption in the returned proposal.

## Scope Check

- Primary audience: Tableau agent
- Authoring outcome improved: calculate, create, validate
- In-scope reason: Gives the proven two-call template path for rates, ratios, and other derived measures that are not already workbook fields.
- Out-of-scope risk: Summary-data row order does not prove the visual sort order.
- Tags: calculated-field, derived-metric, template-binding, ratio, rate, percentage, win-rate
- Relevant user prompts/search terms: "win rate", "ratio", "conversion rate", "completion rate", "derived metric chart", "calculated percentage"

## When to Use

Use this when the requested chart can be built through `bind-template`, but its measure does not yet exist in the workbook. This is especially useful for ratio-style metrics such as win rate, conversion rate, completion rate, or margin.

When the calculation is needed only for the current chart, put it in the first call's `calcs` prelude. When it must be reused across several sheets, `author-calc` followed by binding the caption is also proven, but costs an extra call.

## Best Practices

- Send the user's ask verbatim with `auto_apply:true` and a complete `calcs` entry: caption, formula, datatype, and role.
- Resubmit the same ask verbatim with the concrete proposal.
- Bind the new field by its human-facing caption.
- Put required visual ordering in the proposal's `sort` object.
- Use aggregate formulas for rates and ratios, such as `SUM([Won]) / SUM([Played])`.
- Verify the rendered values with `get-summary-data`.
- Carry the intended `session` on every call when more than one Desktop instance may be available.

## Common Mistakes

1. Changing the ask between the calculation-prelude call and the proposal call.
2. Omitting calculation metadata, which prevents reliable field authoring and binding.
3. Authoring a one-chart calculation separately when the prelude can create it in the same flow.
4. Declaring success after apply without verifying plausible values.
5. Treating summary-data row order as proof of visual sort direction. Readback order is not visual-order evidence.
6. Trying manual sort repair after a sorted proposal has applied and the values are verified. That adds risk without producing better sort evidence.

## Implementation

For a descending Win Rate chart:

```json
[
  {
    "tool": "bind-template",
    "input": {
      "session": "<session>",
      "ask": "Build a bar chart of Win Rate % by team, sorted highest to lowest.",
      "auto_apply": true,
      "calcs": [
        {
          "caption": "Win Rate %",
          "formula": "SUM([Won]) / SUM([Played])",
          "datatype": "real",
          "role": "measure"
        }
      ]
    }
  },
  {
    "tool": "bind-template",
    "input": {
      "session": "<session>",
      "ask": "Build a bar chart of Win Rate % by team, sorted highest to lowest.",
      "auto_apply": true,
      "proposal": {
        "template": "ranking-ordered-bar",
        "title": "Win Rate % by Team",
        "confidence": 0.9,
        "bindings": [
          {
            "slot_id": "region",
            "field": "Team Name"
          },
          {
            "slot_id": "sales",
            "field": "Win Rate %"
          }
        ],
        "sort": {
          "by": "Win Rate %",
          "direction": "desc"
        }
      }
    }
  },
  {
    "tool": "get-summary-data",
    "input": {
      "session": "<session>",
      "worksheet": "Win Rate % by Team"
    }
  }
]
```

### What is confirmed working

- The `calcs` prelude can author an aggregate ratio and make its caption bindable.
- A ranking proposal can bind the dimension and derived metric and request descending sort.
- `get-summary-data` can verify that derived values rendered.
- `author-calc` followed by binding the caption remains a valid reuse path.

### What does not work or is not valid proof

- Summary-data row order does not prove visual sort direction.
- A previously pinned or inferred session is not guaranteed to be the intended target; pass the session explicitly when needed.

## Source and Confidence

- Source/evidence type: live Desktop proof, sanitized for product use
- Customer-identifying and run-specific details removed: yes
- Confidence: field-tested
