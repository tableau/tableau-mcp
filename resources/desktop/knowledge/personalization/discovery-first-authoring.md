# Discovery-First Authoring: Inventory and Align Before You Build

## Scope Check

- Primary audience: Tableau users building a new viz with the agent (and SEs assisting them)
- Authoring outcome improved: The agent grounds chart asks in the template catalog and live fields, then builds a guarded worksheet artifact and applies it without fabricating fields.
- In-scope reason: Directly improves how the agent turns an ambiguous "build me a viz" into a viable, correct Tableau viz grounded in the real workbook.
- Out-of-scope risk: Not a project-scoping or requirements-gathering framework, and not a dashboard/whole-workbook assembly flow - this is scoped to a single non-trivial build-a-viz turn.
- Tags: discovery, alignment, inventory, build a viz, clarify, mismatch, surface selection, available fields, data reality, blind build, fabricated field
- Relevant user prompts/search terms: "build me a chart of sales", "make a viz of profit margin", "plot sales by region", "I want a graph showing revenue over time", "add a chart for this data", "what's in this workbook before you build"

## When to Use

For a chart/graph/viz ask, inspect `list-templates` and `list-available-fields`, choose a compatible template and real field mapping, call `build-worksheets-from-templates`, then pass its artifact to `apply-worksheet`. The build step does not change the workbook; the apply step adds the new worksheet.

`get-worksheet-xml` is available before or after authoring for inspecting or editing an existing worksheet. It has no template or authoring prerequisite.

Discovery-first still applies where it helps:

- Inventory-only asks can start with ungated session, worksheet, dashboard, datasource, or workbook inventory tools.
- Parameter and set asks can start with `author-parameter` or `author-set`.
- Existing-sheet inspection, edit, and repair asks can start with `get-worksheet-xml` or the relevant authoring tool. `list-available-fields` is always available for diagnosis.

Skip broad discovery for trivial single-step edits. Use only the inventory needed to resolve an existing target.

## Best Practices

1. **Use the guarded template path for charts.** Read the template catalog and live fields, build one worksheet artifact with a complete mapping, then apply that exact artifact. Build and apply each worksheet in sequence; do not batch artifact construction because a later build invalidates the prior artifact.
2. **Inspect existing sheets directly.** Use `get-worksheet-xml` whenever an existing worksheet's structure is needed for inspection, repair, verification, or a follow-up edit. No earlier mutation is required.
3. **Inventory cheap-first when the ask is inventory.** Start with session, worksheet, dashboard, or datasource listings. Use `get-workbook-xml` only when it is offered and exact structure is required. Budget 2-4 discovery calls; do not loop.
4. **Restate the goal in one line.** Reflect back what the user is asking for so a mismatch surfaces immediately ("You want a monthly trend of profit margin by region.").
5. **Name what exists.** Briefly state the relevant fields, sheets, and data sources you found, so the user can see you are building on their real workbook.
6. **Flag mismatches explicitly.** Call out a missing field, a high-cardinality dimension, the wrong grain, or an aggregation problem before building.
7. **Ask at most 1-2 clarifying questions, only when a mismatch blocks safe building.** Otherwise proceed with the best-supported interpretation and state what you assumed.
8. **Never fabricate a field.** If a requested field does not exist, say so and offer the closest real field or a calculated field to create (with confirmation).
9. **Build, then verify.** Hand off to the existing build recipes and read back to confirm the viz landed.

### When to Say No

Say no (or pause) when the request references data that does not exist, or when building it as asked would fabricate fields or produce a misleading viz.
Exception: a missing relationship that only describes a plausibly pre-scoped datasource is not itself a refusal; apply `expertise://tableau/strategy/workflow/scoped-data-not-a-refusal`.

Recommended wording:

> "I don't see a `Profit Margin` field in this workbook - it has Sales, Profit, Category, Region, and Order Date. I can build a margin as a calculated field (Profit / Sales), or chart Profit directly. Which would you like before I build it?"

Offer this instead:

- The closest real field, or a calculated field to create (with confirmation)
- A chart type or authoring surface better suited to the data that actually exists
- A scoped alternative when the literal request would be unusable (e.g., high-cardinality)

## Common Mistakes

1. **Treating inspection as gated.** Delaying `get-worksheet-xml` until after a mutation even though existing worksheets can be inspected before authoring.
2. **Fabricating a non-existent field.** Referencing a column the user named but that is not in the data, producing a broken or empty apply instead of flagging it.
3. **Ignoring existing state.** Not checking current sheets/data sources, then duplicating or conflicting with what is already there.
4. **Over-discovery.** Pulling a full `get-workbook-xml` plus many calls for a trivial one-step edit - discovery should be skipped for those.
5. **Over-interviewing.** Asking many clarifying questions instead of proceeding with one clear stated assumption. Cap clarifying questions at 1-2.
6. **Wrong surface.** Reaching for a custom build when a native chart fits, or vice versa, because the surface decision was skipped.

## Implementation

The routed discovery flow:

1. **Bootstrap:** if needed, call `list-instances` and capture `session`; otherwise omit it to use the pinned or only running Desktop.
2. **Route the first move:** chart ask -> `list-templates` plus `list-available-fields`; parameter/set ask -> `author-parameter`/`author-set`; existing-sheet inspection or edit -> `get-worksheet-xml` or the relevant authoring tool; inventory-only ask -> inventory tools.
3. **Discover deliberately:** use `list-available-fields` at any time for field exploration, and `get-worksheet-xml` whenever exact existing-sheet structure is needed.
4. **Align:** restate the goal; name relevant fields/sheets; flag any mismatch; choose the authoring surface.
5. **Clarify (bounded):** ask at most 1-2 `ask-user` questions, only when a mismatch blocks safe building.
6. **Build and verify:** call `build-worksheets-from-templates`, apply its artifact once with `apply-worksheet`, and read back what landed. After a pre-dispatch construction failure, try at most one different candidate. If the apply outcome is uncertain or post-apply verification fails, stop without retrying, replaying, or rebuilding automatically.

Telemetry: if you start an episode for the discovery turn, call `tableau-begin-episode` once and `tableau-end-episode` only for the episode you started. Otherwise keep the discovery summary and chosen surface in your normal response; do not invent episode tools.

## Related Knowledge

- Validate Data — availability and quality (nulls, grain, freshness) before building: `expertise://tableau/personalization/validate-data-before-building`
- Frame the Question — what the dashboard must answer, and what a dashboard can credibly give: `expertise://tableau/personalization/frame-the-question-before-building`

- Extends [Dashboard Performance and Designing Efficient Workbooks](data/knowledge/tactics/data/dashboard-performance-efficient-workbooks.md): the align step reuses its "when not to add a filter per dimension / high-cardinality" judgment.
- Relates to [Hidden filter is not security](data/knowledge/tactics/governance/hidden-filter-not-security.md): an example of flagging a mismatch and pushing back rather than silently complying.

## Source and Confidence

- Source/evidence type: design-derived from a live authoring session, generalizing existing SE knowledge
- Source: discovery-first authoring design (office-globe authoring session, 2026-06-10) - generalizes the "inventory and align before building" pattern observed when a build ignored existing workbook/data reality; pending eval validation
- Customer-identifying details removed: yes
- Confidence: needs review
- Last reviewed: 2026-06-10
