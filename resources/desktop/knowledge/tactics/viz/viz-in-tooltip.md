# Show Finer-Grain Members with Viz in Tooltip

Keep visible marks at an aggregate grain while a separate detail worksheet supplies finer-grain hover content.

## Scope Check

- Primary audience: Tableau agent
- Authoring outcome improved: create, compose, validate
- In-scope reason: Provides the proven worksheet-XML route for embedding a detail sheet in a customized tooltip.
- Out-of-scope risk: XML round-trip does not observe the actual hover render.
- Tags: tooltip, viz-in-tooltip, hover, detail-sheet, aggregate-grain, attr, customized-tooltip
- Relevant user prompts/search terms: "tooltip", "viz in tooltip", "show members on hover", "hover detail", "keep aggregate bars", "inspect contributing teams"

## When to Use

Use this when the visible parent viz must remain at an aggregate grain, but the user wants to inspect finer-grain members on hover. Build one aggregate parent worksheet and one finer-grain detail worksheet, then reference the detail sheet from the parent's customized tooltip.

Use `expertise://tableau/tactics/viz/small-multiples-facet-col` when the dimension should be visible as panes rather than hidden in hover detail.

## Best Practices

- Build the aggregate parent sheet first and verify that its row count remains at the requested grain.
- Build a separate detail sheet for the hover content.
- Use the two-call `bind-template` protocol for each sheet.
- In an aggregated parent view, a dimension on Tooltip must use Attribute derivation; see `expertise://tableau/tactics/viz/tooltip`.
- Treat `%many-values%` as evidence that ATTR preserved the parent grain but collapsed several finer-grain members behind a mark.
- Use a customized tooltip with a `<Sheet name="...">` reference when the user needs member-level hover detail.
- State the evidence precisely: clean apply plus XML round-trip proves the tooltip reference survived; actual hover rendering remains UNOBSERVED until captured live.

## Common Mistakes

1. Putting the finer-grain dimension on Detail or LOD in the parent view. In the observed case, this changed the parent from aggregate rows to finer-grain rows.
2. Using an ATTR tooltip field and expecting a list of members. It preserved aggregate grain but read back `%many-values%`.
3. Adding the finer-grain field to the parent view when the ask is hover-only.
4. Claiming that XML readback proves the hover rendered. It does not.

## Implementation

Build the parent:

```json
{
  "tool": "bind-template",
  "input": {
    "session": "<session>",
    "ask": "Build a bar chart of total Goals by Group Name, with contributing Team Name members available on hover.",
    "auto_apply": true,
    "proposal": {
      "template": "ranking-ordered-bar",
      "title": "Total Goals by Group Name",
      "bindings": [
        {
          "slot_id": "region",
          "field": "Group Name"
        },
        {
          "slot_id": "sales",
          "field": "Goals",
          "derivation": "sum"
        }
      ],
      "confidence": 0.9
    }
  }
}
```

Build a separate detail sheet such as `Teams in Group (tooltip)` with Team Name and Goals. Then fetch the parent with `get-worksheet-xml` in file mode and update its cached worksheet through `write-cached-xml`. The load-bearing shape is:

```xml
<customized-tooltip>
  <formatted-text>
    <run>Group &lt;[datasource].[none:group_name:nk]&gt;</run>
    <run>Total Goals: &lt;[datasource].[sum:goals:qk]&gt;</run>
    <run>&lt;Sheet name=&quot;Teams in Group (tooltip)&quot; maxwidth=&quot;320&quot; maxheight=&quot;300&quot; filter=&quot;&lt;All Fields&gt;&quot;&gt;</run>
  </formatted-text>
</customized-tooltip>
```

Apply with `apply-worksheet`, read the parent back, and verify that:

- the `<Sheet>` reference survived;
- the parent summary row count remains at aggregate grain;
- the detail sheet exists and is populated.

### What is confirmed working

- Customized tooltip XML containing a detail-sheet reference can apply and round-trip.
- An ATTR tooltip field can preserve aggregate parent grain.
- A separate detail sheet avoids adding its dimension to the parent view's level of detail.

### What does not work or remains unobserved

- A detail/LOD encoding changed the observed parent to finer-grain rows, so it did not satisfy the hover-only ask.
- An ATTR tooltip field returned `%many-values%` rather than a member list.
- The actual hover render is UNOBSERVED. Do not claim it works from XML readback alone.

## Source and Confidence

- Source/evidence type: live Desktop proof, sanitized for product use
- Customer-identifying and run-specific details removed: yes
- Confidence: field-tested for apply and round-trip; hover render unobserved
