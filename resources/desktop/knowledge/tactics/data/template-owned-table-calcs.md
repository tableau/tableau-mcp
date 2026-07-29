# Let the Template Own Its Table Calculation

For a running-total waterfall, bind the step measure and category to the waterfall template instead of duplicating the template's table-calculation logic.

## Scope Check

- Primary audience: Tableau agent
- Authoring outcome improved: create, calculate, validate
- In-scope reason: Gives the proven binding route for a waterfall whose template owns the running total.
- Out-of-scope risk: This does not prove that every template owns every requested calculation.
- Tags: table-calculation, running-total, waterfall, template-owned, goal-difference, field-collision
- Relevant user prompts/search terms: "running total", "waterfall", "bridge chart", "running goal difference", "cumulative steps", "Goals minus Goals Against"

## When to Use

Use this when the user asks for a running-total or part-to-whole waterfall and the available template already carries the accumulation behavior. Bind the per-step measure and category; let the template own the running total.

Check available fields before creating a likely duplicate calculation. The proven recovery path used an existing datasource field after a calculation prelude collided with it.

## Best Practices

- Call `bind-template` first for a named waterfall ask.
- Bind the per-step measure to the template's measure slot and the category to its dimension slot.
- Check available fields before authoring a calculation with a likely existing caption or local name.
- Existing snake_case local names can be valid bindings when returned by field discovery.
- Verify worksheet structure and summary values separately. Summary rows are numeric evidence, not proof of rendered mark structure.
- Do not author a second running-sum calculation unless evidence shows the template does not own the behavior.

## Common Mistakes

1. Creating `Goal Difference` when the datasource already contains `goal_difference`. The observed caption collision failed.
2. Duplicating running-total responsibility in both a calculation and the template.
3. Treating summary rows as proof of the rendered structure. Summary rows prove values exist; they do not prove mark type, shelf placement, or sort order.
4. Claiming datasource-authored `RUNNING_SUM` fails. That route was not tested.

## Implementation

Use the user's ask verbatim. If an attempted calculation prelude collides with an existing field, list fields and bind the existing local name:

```json
[
  {
    "tool": "bind-template",
    "input": {
      "session": "<session>",
      "ask": "Build a waterfall chart showing the running goal difference by team.",
      "auto_apply": true
    }
  },
  {
    "tool": "bind-template",
    "input": {
      "session": "<session>",
      "ask": "Build a waterfall chart showing the running goal difference by team.",
      "auto_apply": true,
      "proposal": {
        "template": "part-to-whole-waterfall",
        "title": "Running Goal Difference by Team",
        "confidence": 0.9,
        "bindings": [
          {
            "slot_id": "profit",
            "field": "goal_difference",
            "derivation": "sum"
          },
          {
            "slot_id": "sub_category",
            "field": "team_name",
            "derivation": "none"
          }
        ],
        "sort": {
          "by": "goal_difference",
          "direction": "desc"
        }
      }
    }
  }
]
```

After apply, use `get-summary-data` for numeric readback and `get-worksheet-xml` for the worksheet structure.

### What is confirmed working

- The part-to-whole waterfall template can own running-total behavior.
- Existing datasource local names can bind directly into the proposal.
- The observed proposal produced internally consistent summary rows and worksheet structure.

### What does not work or remains unconfirmed

- A calculation prelude that duplicates an existing datasource field caption failed with a collision.
- Creating `RUNNING_SUM` as a datasource calculation was not tested; do not claim it fails.
- Summary rows prove values exist; they do not prove mark type, shelf placement, or sort order.

## Source and Confidence

- Source/evidence type: live Desktop proof, sanitized for product use
- Customer-identifying and run-specific details removed: yes
- Confidence: field-tested
