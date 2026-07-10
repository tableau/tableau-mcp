# Filters Don't Automatically Cross a Data Blend — Linking Fields, Secondary-Source Filters & Filter Actions

In a data blend, filters are scoped to **one data source at a time**. A quick filter or a filter action built on the primary source does NOT automatically narrow a blended secondary source unless the filtered field is an active **linking field**. This is why "filters not applied to the secondary source" and "filter action across blended sources does nothing" are the two most common blend-interactivity failures — and why the durable fix is usually a relationship, not a blend.

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: create, troubleshoot
- In-scope reason: Explains why filters and filter actions do not propagate across a blend (per-source scope + linking-field grain), how to make the shared field a linking field or filter the secondary directly, and when to move to a relationship so propagation is automatic.
- Out-of-scope risk: none
- Tags: data-blending, blend, secondary-source, primary-source, linking-fields, filter-action, cross-source-filter, filter-propagation, relationships-vs-blend, chain-link
- Relevant user prompts/search terms: "action filter with blended data sources", "filter action across two data sources", "filters not applied to secondary data sources when non-filtered fields are shared", "filters not applied to the secondary data source", "quick filter doesn't affect the blended secondary source", "filter on primary not filtering secondary", "how do I make a filter apply to both data sources", "blend linking fields", "secondary source ignores my filter", "cross-source filter action", "data blending filter propagation", "filter across primary and secondary source", "non-linking field filter not shared"

## When to Use

Use this when a view combines two data sources by **blending** (a primary source plus a secondary source joined on shared linking fields, shown with the chain-link icon in the Data pane) and an interaction isn't propagating:

- A quick filter (or dashboard filter) on a primary field leaves the secondary source's numbers unchanged.
- A filter **action** originating from a blended sheet does nothing to a target that reads the secondary source.
- You need one control to scope both sources at once.

If the requirement is really "combine these tables so everything filters together," the honest answer is often *don't blend* — model it as a relationship. See the Best Practices and the datasource-strategy companion.

## Best Practices

1. **Know what a blend actually does.** The primary source drives the view. The secondary source is **aggregated to the grain of the active linking field(s)** and left-joined onto the primary in that view only. Because each source is queried separately, a filter belongs to exactly one source's query.
2. **A primary filter reaches the secondary only through a linking field.** If the filtered dimension is an **active linking field** (the chain link is engaged in this sheet), filtering its members restricts which secondary rows join, so the secondary appears to filter. Filtering a **non-linking** primary field does not touch the secondary query at all — this is the R088 root cause.
3. **To filter the secondary directly, filter the secondary's own field.** Add a filter using the secondary source's copy of the field (select the secondary source in the Data pane first). Each source carries its own filter; there is no shared filter object across a blend.
4. **To make a shared field propagate, activate it as a linking field.** In the secondary source, click the gray chain-link next to the shared dimension so it turns active (or set the blend relationship under Data → Edit Blend Relationships). Then a primary filter on that field scopes the secondary.
5. **For click-to-filter interactivity across sources, prefer relationships.** A **filter action** targets fields in a specific data source; across a blend it only affects a target's secondary when the action's source field maps to an active linking dimension there. This is fragile. If cross-source interactivity is the goal, combine the tables with a **relationship** (a single logical data source, 2020.2+) so quick filters and filter actions propagate normally — that is the R056 fix.
6. **Reserve blends for the case they're good at:** a secondary source at a *different, coarser grain* (e.g. targets/quotas by Region) that you only need aggregated onto the primary. Don't blend just to combine two same-grain tables — relate or join them.

## Common Mistakes

1. **Expecting a primary quick filter to filter the secondary.** It won't, unless the filtered field is an active linking field. Filter the secondary's own field, or activate the link.
2. **Building a filter action across a blend and assuming it flows to the secondary.** The action scopes one source; the target's secondary only responds when the action field is an active linking dimension there.
3. **Blending two same-grain tables that should be related.** Blends can't do LOD across sources, always aggregate the secondary, and can't be published as one governed source — a relationship avoids all three limits.
4. **Filtering on a linking field but leaving the link inactive** in that sheet — the chain must be engaged for the scope to carry.
5. **Assuming secondary measures behave like primary measures.** Secondary measures are always aggregated (you cannot use them at row level, and no LOD expression can cross the blend).

## Implementation in Tableau Desktop

Scenario A — a filter on the primary is not affecting the blended secondary (R088):

1. Identify whether the filtered field is an **active linking field** in this sheet (chain-link engaged next to it in the secondary source).
2. If it is not, either (a) add a filter on the **secondary source's own** copy of that field, or (b) activate the shared field as a linking field so the primary filter scopes the secondary.
3. Re-check the secondary numbers after applying; a blend filter that "does nothing" almost always means you filtered a non-linking field.

Scenario B — a filter action needs to work across blended sources (R056):

1. Confirm the action's **source field** exists as an **active linking dimension** on the target that reads the secondary; only then can the action scope that secondary.
2. If it does not map cleanly (different grain, non-linking field), stop blending for this case and **model a relationship** instead: relate the two tables on their key, so the combined source is one logical data source where quick filters and filter actions propagate to every table automatically.
3. Validate by triggering the interaction and reading the target back — the secondary marks should change; if only the primary changes, the action isn't reaching the secondary.

Rule of thumb: **blend for aggregate-only, different-grain secondaries; relate/join when you need filters, actions, or LOD to cross the boundary.**

## Related Knowledge

- `expertise://tableau/strategy/data-modeling/datasource-strategy` — relationships vs. joins vs. blends; when to move off a blend to a single logical source.
- `expertise://tableau/strategy/viz-design/filter-strategy` — Tableau's filter order of operations and filter-type selection.
- `expertise://tableau/tactics/viz/filters` — the XML/authoring mechanics for categorical, quantitative, date, and cross-sheet filters.
- `expertise://tableau/tactics/dashboard/zones` — dashboard filter and action wiring.

## Source and Confidence

- Source/evidence type: internal-doc synthesis
- Source: consolidated from this repo's datasource-modeling and filter expertise modules (relationships vs. joins, filter order of operations, cross-sheet filter authoring); blend linking-field and per-source filter-scope behavior are standard Tableau data-blending semantics
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-07-05
