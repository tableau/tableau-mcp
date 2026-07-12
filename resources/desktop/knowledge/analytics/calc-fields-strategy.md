# Calculated Fields, Parameters & Table Calculations

Strategy guide for deciding how to model logic in Tableau calculations: when to reach for an LOD expression, a table calculation, or a parameter, and how the Order of Operations should drive those choices.

---

## When to Use This Module

Use this guide when:

- **Adding a calculated field** to a datasource, such as profit ratio, date difference, or string categorization
- **Translating SQL expressions** to Tableau calculated fields during datasource refactoring
- **Setting up a parameter** with a list or range of allowed values that a calculation references
- **Configuring a table calculation** such as running total, rank, percent of total, or moving average
- **Applying a Top N filter per partition** using the rank-on-rows pattern
- **Debugging unexpected filter/calc interactions** with the Tableau Order of Operations

For XML and authoring mechanics, see `expertise://tableau/tableau-tactics/data/calc-fields`. For SQL-specific translation mechanics, see `expertise://tableau/tableau-tactics/data/sql-translation`.

---

## LOD vs. Table Calc: The Core Decision

LOD (Level of Detail) expressions and table calculations both compute at a granularity other than the view, but they answer different questions and live at different points in the Order of Operations. Picking the wrong one is the most common modeling mistake.

| Tool | Computes on | Best when |
|---|---|---|
| `FIXED` LOD | Underlying rows, at a fixed grain you name | You need an entity-level value, such as per-customer total, that does not change as the view is re-sliced |
| `INCLUDE` / `EXCLUDE` LOD | Underlying rows, relative to the view's grain | You want the view's grain plus or minus one dimension, and the result should react to dimension filters |
| Table calc | Aggregated results visible in the view | The answer is inherently positional or relative, such as running totals, rank, percent-of-total, or period-over-period |

Decision rule: if the answer should be stable regardless of what is on the shelves, reach for an LOD. If the answer is "relative to the other marks in this view" - rank, running sum, or percent of visible total - it is a table calc by nature.

Check LOD-legal aggregates before defaulting to a table calc. The aggregate set usable inside an LOD is wider than many authors expect, including `PERCENTILE`, `MEDIAN`, `STDEV`, `VAR`, `CORR`, and `COVAR`. Using an LOD keeps the calc evaluable anywhere and removes the "must have the partitioning dimension on Detail" constraint that a table calc imposes.

---

## PERCENTILE-in-LOD vs. NTILE Table Calc

For quintile or decile segmentation such as RFM, prefer a nested-LOD `PERCENTILE` cutoff over the `INDEX()/SIZE()` table-calc workaround. The LOD version becomes a row-level attribute that works in any view; the table-calc version only resolves when the partitioning dimension sits on Detail.

Collapse each entity to one row with an inner `FIXED` before taking the percentile so high-transaction entities are not over-weighted.

Caveat: SQL `NTILE(k)` forces exactly 1/k of rows per bucket by splitting ties. PERCENTILE cutoffs put tied values in the same bucket. That is usually better for segmentation because identical entities get identical treatment, but it is not exact NTILE parity.

For concrete nested-LOD formulas, see `expertise://tableau/tableau-tactics/data/calc-fields`.

---

## Membership vs. Value: Set vs. RANK, Filter, or LOD

The single most common wrong turn on top/bottom-N performer tasks is confusing **membership** with **value**. Before writing a RANK, LOD, or Top-N filter, ask what the output is: a value, or group membership?

| You want... | Use | Why |
|---|---|---|
| A **displayed ordinal value** such as a rank number on the viz, Pareto, `RANK_UNIQUE` table-calc filter, or per-partition rank | **RANK / table calc** | The answer is positional and relative to marks in the view |
| A **stable per-entity value** independent of the view | **LOD** | Computed on underlying rows at a fixed grain |
| **Group membership** such as Top / Bottom / Everyone-Else to color rows, keep-and-roll-up the rest, or drive a click/parameter action | **Set** | Only a set tags membership while keeping all rows, can be a set-action target, and can re-rank live per period |

The decisive test:

- A Top-N filter **removes** the other rows. That is wrong when you must keep the middle, such as rolling it into an "Everyone Else" bar.
- A positional-table-calc-as-membership calc, such as `IF RANK(...) <= [param] THEN "Top" ELSEIF ... ELSE "Everyone Else"`, is the wrong shape. It cannot be a set-action target, will not re-rank live in the same way, and often will not resolve as a dimension because table calcs run after the grouping is needed.
- This is not specific to `RANK`. `INDEX() <= [param]`, `FIRST()`, and `LAST()` are the same wrong turn when they are used as membership labels.

RANK, INDEX, filters, and LODs are all correct tools for values. They are the wrong tool only for membership.

---

## Parameters: When to Reach for One

A parameter is the right tool when the user needs to drive the analysis with a value the data does not contain: a Top-N threshold, a what-if input, a date-range bound that controls densification, or a switch between measures.

Prefer a parameter over a quick filter whenever the control must stay independent of the data. A filter can only choose from values present and can accidentally remove rows; a parameter can preserve all members while changing what a calculation counts.

---

## Tableau Order of Operations

Know this when debugging why filters and calculations interact unexpectedly:

1. Extract Filters
2. Data Source Filters
3. **Context Filters**
4. Sets / Conditional Filters / Top N / **FIXED LOD**
5. Dimension Filters
6. INCLUDE/EXCLUDE LOD
7. Measure Filters
8. **Table Calculations**
9. **Table Calc Filters**
10. Trend/Reference Lines

Key implications:

- **Context filters** restrict data before FIXED LODs, so use them to scope LOD calculations.
- **Table calc filters** run after all aggregation, which is ideal for Top N via `INDEX() <= N`.
- Prefer **table calcs + context filters** over FIXED LODs for flexible analysis when the result should react to the visible view.

---

## Table Calculations: Choosing Scope

Once a problem is genuinely positional, the strategic choice is what the calc partitions and addresses over. Get the Compute Using scope right and the calc is robust; get it wrong and it silently restarts on the wrong dimension.

- **Use Specific Dimensions, not Table/Pane direction, in any view with more than one dimension.** Table Across/Down and Pane direction are guesses that break when a trellis or extra dimension is added.
- **Match the addressing dimension to the analytical question.** A rank "within each month" partitions by month and addresses by the ranked entity. A running total "over time" addresses by the date.

Common recipes such as bump charts, `WINDOW_*` KPI/sparkline tables, per-partition Top-N, and `INDEX()` data densification share this strategic point and differ only in mechanics. For workbook XML mechanics, see `expertise://tableau/tableau-tactics/data/calc-fields`.

---

## Data Densification: a Filtering-Strategy Decision

When a crosstab or heatmap must show every dimension combination, including empties, the strategic trap is the filter type, not the calc. A standard or context filter physically removes members from the view, which destroys densification and skews any average whose denominator should include the zero-activity members.

The fix is to keep all members present and control what gets counted with a parameter-driven `IF` inside the measure, paired with `ZN()` to turn nulls into zeros.

| Filter type | Effect on dimensions | Safe for densification? |
|---|---|---|
| Standard dimension filter | Removes filtered values from view | No - breaks densification |
| Context filter | Removes filtered values from view | No - breaks densification |
| Parameter + `IF` in calc | All values remain; measure returns 0 for excluded rows | Yes |

---

## Per-Partition Top-N: a Shaping Decision

To show Top-N per partition, such as top 10 sub-categories per month, put RANK on Rows and the ranked dimension on Label. Putting the dimension on Rows unions across all partitions and defeats the per-partition intent.

The filter that keeps ranks 1-N belongs at the table-calc stage of the Order of Operations, for example `INDEX() <= [Top N]`.

---

## SQL Window/Aggregate Translation

When porting SQL-derived logic, the LOD-vs-table-calc decision maps directly onto SQL constructs:

- A `GROUP BY` aggregate is a `FIXED` LOD: stable at the named grain.
- An `OVER (PARTITION BY ... ORDER BY ...)` window function is a table calc: positional within the view.
- `NTILE(k)` maps to the PERCENTILE-LOD pattern when equal-count buckets matter.

For the SQL-to-Tableau lookup table and equal-count vs. equal-width bucket caveat, see `expertise://tableau/tableau-tactics/data/sql-translation` and `expertise://tableau/analytics/sql-translation-strategy`.

---

## Best Practices

- **Use context filters with FIXED LODs.** FIXED LOD calculations ignore regular dimension filters. Right-click the filter in the Filters shelf and choose Add to Context to scope the LOD.
- **Choose LOD over table calc when possible.** LODs evaluate before dimension filters and do not require the partitioning dimension to be present in the view.
- **Use `ZN()` to handle null measures in densified views.** Without `ZN`, densified empty cells return null and distort averages.
- **Prefer PERCENTILE-LOD over NTILE table calcs** for quintile/decile segmentation because it is row-level, works anywhere in the view, and produces better semantics for entity-level analysis.
- **Use Specific Dimensions for Compute Using in trellis views.** Table Down and Table Across can restart unexpectedly when multiple dimensions are present.

---

## Common Mistakes

1. **FIXED LOD ignoring a dashboard filter.** FIXED LOD runs before dimension filters. Make the controlling filter a context filter so it scopes the LOD.
2. **Table calc dimension not in the view.** Table calcs require their partitioning dimension to be present somewhere in the view: Rows, Columns, Color, Detail, or Path.
3. **Using NTILE range-mapping for exact equal-count buckets.** Range-mapping creates equal-width buckets, not equal-count. For quintiles matching SQL NTILE semantics, use the PERCENTILE-LOD pattern.
4. **Percent of Total on the wrong base.** When the underlying measure uses COUNTD, the table calc must aggregate by COUNTD. Using SUM as the base produces wrong totals.
5. **INDEX() densification breaking when quick filters are added.** Quick filters remove dimension members from the view, defeating densification. Use parameter-based filtering instead.
6. **INCLUDE/EXCLUDE vs. FIXED for filter scoping.** INCLUDE and EXCLUDE run after dimension filters. FIXED runs before dimension filters. Using INCLUDE where FIXED is needed produces results that change unexpectedly as filters are applied.

---

## Implementation

This is a decision workflow, not an XML recipe:

1. **State the question precisely.** Is the answer entity-stable, such as per-customer or per-account, or relative-to-the-view, such as rank, running total, or percent of visible total?
2. **Pick the tool from the question.** Entity-stable -> LOD. Relative or positional -> table calc. View-grain-relative -> INCLUDE/EXCLUDE.
3. **Walk the Order of Operations** to confirm filters land where expected, especially that anything meant to scope a FIXED LOD is a context filter and that Top-N filtering happens at the table-calc stage.
4. **Decide the parameter vs. filter question** for any user-driven input or densification need. Parameter keeps members present; filter removes them.
5. **Hand off to mechanics.** Once the modeling choice is settled, build it using `expertise://tableau/tableau-tactics/data/calc-fields`, then verify in Tableau that totals, ranks, and densified denominators behave as intended.

---

## Source and Confidence

- Source/evidence type: SME-authored reference
- Source: Tableau calc-authoring best practice (LOD vs. table-calc decision rules, order-of-operations) from SE field practice
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
