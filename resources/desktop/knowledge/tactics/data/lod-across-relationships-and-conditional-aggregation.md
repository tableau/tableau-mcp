# Cross-Grain Calcs — FIXED-LOD Lookups Across Relationships, Conditional Match-and-Sum & the LOD-vs-Table-Calc Choice

Three adjacent asks are the same decision: *at what grain, and at what step of the pipeline, is this value computed?* "Look up a value in a related table," "sum the values where two columns match," and "flag rows above a threshold two ways (LOD vs table calc)" all hinge on choosing among a **FIXED LOD**, a **row-level conditional aggregation**, and a **table calc** — and on Tableau's order of operations, where `FIXED` runs *before* dimension filters and table calcs run *last*. Pick the right grain and step and the number is correct; pick wrong and it is silently off, double-counted, or won't resolve as a dimension at all.

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: calculate, create, troubleshoot
- In-scope reason: Gives the decision rule for computing a value at a grain other than the current row/view — a `FIXED`-LOD lookup (including across a relationship, where the model changes the arithmetic), a same-row conditional match-and-sum vs a self-join, and an LOD-vs-table-calc threshold flag — grounded in the order-of-operations pipeline.
- Out-of-scope risk: none
- Tags: lod, fixed, include, exclude, relationships, related-table-lookup, conditional-aggregation, match-and-sum, order-of-operations, context-filter, lod-vs-table-calc, threshold-flag, fan-out, grain, self-join
- Relevant user prompts/search terms: "use an LOD calculation to look up a value in a related table", "LOD lookup value in related table", "FIXED LOD across a relationship", "how to match two columns and sum the values that match", "sum values where two columns are equal", "conditional sum when a equals b", "threshold analysis two ways LOD vs table calc", "flag categories above a dynamic threshold LOD or table calc", "LOD vs table calc for a threshold", "my FIXED LOD ignores the dashboard filter", "LOD gives different totals on a relationship than a join", "self join to match and sum inflates my totals"

## When to Use

Use this when the value lives at a **different grain than the row or the view**, and you must choose the tool and the pipeline step:

- **"Look up a value in a related table"** — a per-key attribute or aggregate pulled from another table.
- **"Match two columns and sum the matches"** — a conditional aggregation, and the question of whether a relationship/self-join is even needed.
- **A dynamic threshold flag "two ways"** — deciding between an LOD/parameter threshold and a table-calc threshold, which land at different steps of the order of operations.

For the full worked LOD/table-calc *recipe library* (cohort, Pareto, rank-within-group), see the cookbook companion; this entry owns the **which-tool-and-what-step** decision for these three shapes.

## Best Practices

1. **Decide value/grain before syntax.** Entity-stable, independent of what's on the shelves → **LOD** (prefer `FIXED`). Relative to the marks in the view (rank, running, % of visible total) → **table calc**. The view's grain plus/minus one dimension, reacting to dimension filters → **`INCLUDE`/`EXCLUDE`**. This is the canonical decision table — link, don't restate.
2. **On the relationship model (2020.2+), a "related-table lookup" often needs no LOD at all.** A field from a related table is already usable and each table aggregates at its own grain before combining — so pulling `MAX([Attr])` from a related table may just be dragging the field in. Reach for `{FIXED [Key] : AGG([Attr])}` when you need a specific grain *independent of the view*. **Caution: the model changes the arithmetic** — an LOD written for a flat *join* can over/under-count on a *relationship* (native-grain aggregation), so re-verify totals when the model changes. If the "related" source is actually a **blend**, filters and the lookup won't cross it the way you expect — see the blend companion.
3. **"Match two columns and sum the matches" is usually a row-level conditional aggregation, not a join:** `SUM(IF [A] = [B] THEN [Value] END)`. Reach for a self-relationship/join **only** when the match must cross rows or tables (the value lives in a *different* row). When it does, prefer a **relationship** over a join — a many-side join fans out and inflates the `SUM`; relationships aggregate at native grain and avoid the fan-out.
4. **A threshold flag "two ways" lands at two different pipeline steps — choose by how you'll use the flag.** An **LOD/parameter** threshold (`[Value] > {FIXED : AVG([Value])}`, or `> [Threshold Param]`) resolves early enough to be used as a **dimension or filter**. A **table-calc** threshold (`RANK(...) <= n`, `WINDOW_*` compared to a bound) runs at step 8 and can only act as a **table-calc filter** (step 9) — it cannot form a discrete grouping. If the flag must drive **membership** (color a group, keep-and-roll-up "everyone else," be a set-action target), that is a **SET**, not a calc of either kind.
5. **Order of operations is the debugging spine.** Context filters (3) → `FIXED` LOD (4) → dimension filters (5) → `INCLUDE`/`EXCLUDE` (6) → measure filters (7) → table calcs (8) → table-calc filters (9). Two consequences: a `FIXED` LOD **ignores** a normal dimension filter — **Add the filter to Context** to scope it; and `INCLUDE`/`EXCLUDE` *do* react to dimension filters because they run after them.
6. **Mind cost and the aggregate/non-aggregate rule.** `FIXED` on a high-cardinality key emits a `GROUP BY` sub-query each — prefer `INCLUDE` that folds into the existing query, or pre-aggregate. And `[Sales] - AVG([Sales])` errors ("cannot mix aggregate and non-aggregate") — wrap the constant: `[Sales] - {FIXED : AVG([Sales])}`.

## Common Mistakes

1. **A self-join to "match and sum"** where a row-level `SUM(IF [A]=[B] THEN [Value] END)` does it — and the join fans out and inflates the totals.
2. **A `FIXED` lookup that ignores the dashboard filter** — it runs before dimension filters. Add the controlling filter to Context (or rewrite as `INCLUDE`).
3. **Porting an LOD from a joined model to a relationship model** and getting different totals — relationships aggregate at native grain before combining; re-verify.
4. **Using a table-calc threshold to make a discrete group label / set-action target** — it evaluates at step 8, after the grouping is needed, so it won't resolve as a dimension. Use a set.
5. **Assuming a related table needs an LOD to be read** — on the relationship model the field is directly usable at its own grain.
6. **Mixing aggregate and non-aggregate** in the threshold expression — wrap the scalar side in an LOD.

## Implementation

1. State whether the value is entity-stable (→ `FIXED` LOD), a same-row condition (→ conditional aggregation), or relative to the marks (→ table calc).
2. Confirm the **data model** — relationship, join, or blend — because it changes the arithmetic of any cross-table value; prefer a relationship over a fan-out join.
3. For a threshold flag, decide up front how the flag is used (dimension/filter → LOD/parameter; display-only rank cutoff → table-calc filter; membership → set).
4. Walk the order of operations for any filter meant to scope the calc — put it in **Context** for a `FIXED` LOD.
5. Build via the calc-fields mechanics, then **verify totals on a multi-row-per-key extract** — a calc that renders can still be aggregating at the wrong grain.

## Related Knowledge

- `expertise://tableau/strategy/analytics/calc-fields-strategy` — the LOD-vs-table-calc decision table, the full order-of-operations pipeline, and the membership-vs-value rule (set vs RANK/LOD).
- `expertise://tableau/strategy/data-modeling/datasource-strategy` — relationships vs joins vs blends, fan-out/chasm traps, and why the model changes LOD totals.
- `expertise://tableau/tactics/data/lod-and-table-calc-patterns` — worked `FIXED`/dedup/conditional-aggregation recipes and the aggregate/non-aggregate wrapping rule.
- `expertise://tableau/tactics/data/calc-fields` — the XML/authoring mechanics for LODs, conditional calcs, and parameters.
- `expertise://tableau/tactics/data/blend-filter-propagation` — when the "related" source is a blend: why the lookup/filter doesn't cross, and when to move to a relationship.
- `expertise://tableau/tactics/data/sets-usage-and-creation` — when the threshold flag is really membership (color/keep-and-roll-up/set-action), use a set.

## Source and Confidence

- Source/evidence type: internal-doc synthesis
- Source: consolidated from this repo's calc-fields strategy (order of operations, LOD-vs-table-calc, membership-vs-value), datasource-modeling (relationships vs joins, fan-out), and LOD/table-calc cookbook expertise modules; `FIXED`-LOD, conditional-aggregation, and order-of-operations behavior are standard Tableau calculation semantics
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-07-06
