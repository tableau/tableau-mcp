# Discovery-First Authoring: Inventory and Align Before You Build

## Scope Check

- Primary audience: Tableau users building a new viz with the agent (and SEs assisting them)
- Authoring outcome improved: Before building a non-trivial viz, the agent inventories what the workbook and data actually contain, restates the user's goal, flags any mismatch between the request and the data reality, and chooses the right authoring surface - instead of blindly building or fabricating fields.
- In-scope reason: Directly improves how the agent turns an ambiguous "build me a viz" into a viable, correct Tableau viz grounded in the real workbook.
- Out-of-scope risk: Not a project-scoping or requirements-gathering framework, and not a dashboard/whole-workbook assembly flow - this is scoped to a single non-trivial build-a-viz turn.
- Tags: discovery, alignment, inventory, build a viz, clarify, mismatch, surface selection, available fields, data reality, blind build, fabricated field
- Relevant user prompts/search terms: "build me a chart of sales", "make a viz of profit margin", "plot sales by region", "I want a graph showing revenue over time", "add a chart for this data", "what's in this workbook before you build"

## When to Use

Use this guidance at the START of any non-trivial build-a-viz request - especially when the request is ambiguous, names a field or metric that may not exist, or could be satisfied several different ways. The goal is to ground the build in the workbook's real state before applying anything.

This applies to:

- A user asking for a chart/graph/viz without specifying exact fields or chart type
- A request that names a measure or dimension that might not be in the workbook (e.g., "profit margin", "channel", "cohort")
- Any moment the agent is about to call an apply tool without having confirmed the workbook actually contains the referenced fields

Skip it for trivial single-step edits (for example "change this bar to a line", "rename this sheet", "make the title bigger") or when the user explicitly says "just do X". Discovery is a front-loaded alignment step, not a tax on every keystroke.

## Best Practices

1. **Inventory cheap-first, with a budget.** Prefer the lightweight inventory calls before anything heavy: `list-available-fields`, then worksheet-list readback, then dashboard-list readback. Only reach for `get-workbook-xml` (mode=file) or `get-workbook-xml` when you actually need exact XML or encodings. Budget normally 2-4 discovery calls before you align; do not loop.
2. **Restate the goal in one line.** Reflect back what the user is asking for so a mismatch surfaces immediately ("You want a monthly trend of profit margin by region.").
3. **Name what exists.** Briefly state the relevant fields, sheets, and data sources you found, so the user can see you are building on their real workbook.
4. **Flag mismatches explicitly.** Call out a missing field, a high-cardinality dimension, the wrong grain, or an aggregation problem before building - this is the single highest-value move of the whole step.
5. **Choose the right authoring surface.** Decide native chart vs. the custom-viz ladder before building; route to chart-selection guidance for chart choice and to the custom-viz solution guidance when the ask is non-standard.
6. **Ask at most 1-2 clarifying questions, only when a mismatch blocks safe building.** Otherwise proceed with the best-supported interpretation and state what you assumed. Do not interrogate the user for cosmetic details you can default safely.
7. **Never fabricate a field.** If a requested field does not exist, say so and offer the closest real field or a calculated field to create (with confirmation). Inventing a column in the applied XML produces a broken or misleading viz.
8. **Build, then verify.** Hand off to the existing build recipes and read back to confirm the viz landed.

### When to Say No

Say no (or pause) when the request references data that does not exist, or when building it as asked would fabricate fields or produce a misleading viz.

Recommended wording:

> "I don't see a `Profit Margin` field in this workbook - it has Sales, Profit, Category, Region, and Order Date. I can build a margin as a calculated field (Profit / Sales), or chart Profit directly. Which would you like before I build it?"

Offer this instead:

- The closest real field, or a calculated field to create (with confirmation)
- A chart type or authoring surface better suited to the data that actually exists
- A scoped alternative when the literal request would be unusable (e.g., high-cardinality)

## Common Mistakes

1. **Blind build.** Applying a viz without first checking what the workbook contains - the most common cause of wrong-field, wrong-grain, or duplicate output.
2. **Fabricating a non-existent field.** Referencing a column the user named but that is not in the data, producing a broken or empty apply instead of flagging it.
3. **Ignoring existing state.** Not checking current sheets/data sources, then duplicating or conflicting with what is already there.
4. **Over-discovery.** Pulling a full `get-workbook-xml` plus many calls for a trivial one-step edit - discovery should be skipped for those.
5. **Over-interviewing.** Asking many clarifying questions instead of proceeding with one clear stated assumption. Cap clarifying questions at 1-2.
6. **Wrong surface.** Reaching for a custom build when a native chart fits, or vice versa, because the surface decision was skipped.

## Implementation

The discovery-first preamble for a non-trivial build-a-viz request:

1. **Bootstrap:** if `list-instances` is absent from the tool list, the session is pinned to the launching Desktop; skip discovery because session-scoped tools already target it. Otherwise, call `list-instances` -> capture `_session`.
2. **Inventory cheap-first (budget 2-4 calls):** `list-available-fields` -> worksheet-list readback -> dashboard-list readback. Use `get-workbook-xml` (mode=file) or `get-workbook-xml` only if you need exact XML/encodings.
3. **Align:** restate the goal in one line; name the available fields/sheets; flag any mismatch (missing field, high cardinality, wrong grain); choose the authoring surface.
4. **Clarify (bounded):** ask at most 1-2 `ask-user` questions, and only when a mismatch blocks safe building; otherwise proceed and state your assumptions.
5. **Build:** hand off to the existing viz recipes (`build-and-apply-worksheet`, or `batch-create-and-cache-sheets`).
6. **Verify:** read back and confirm the proposed worksheet landed; loop back to align on gaps; cap recovery at 3 attempts.

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
