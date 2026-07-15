# Filter Strategy

Strategy guide for *choosing* the right filter approach in Tableau — which filter type fits the question, and how Tableau's order of operations dictates the sequence you must build filters in to get correct results.


**Tactics companion:** `expertise://tableau/tactics/viz/filters` — the XML/authoring mechanics for this topic.

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: create, refine, troubleshoot
- In-scope reason: Helps Claude choose correct filter types and order-of-operations sequencing so FIXED LOD, Top N, and cross-sheet filters work as intended.
- Out-of-scope risk: none
- Tags: filters, context-filters, top-n, date-filters, order-of-operations
- Relevant user prompts/search terms: "top N within each region", "top 10 by category", "context filter", "filter order of operations", "limit to top performers per group", "rank within a partition"

## When to Use

Use this guide when:
- **Filtering a worksheet to specific dimension values** (e.g., Region = "East", Segment in {Consumer, Corporate})
- **Applying a date filter** — categorical (year/quarter/month) or continuous (date range)
- **Creating a Top N filter** that limits a dimension to its top N members by a measure
- **Setting up cross-sheet filters** that synchronize multiple worksheets on a dashboard
- **Applying a context filter** to scope FIXED LOD calculations or Top N filters
- **Filtering Measure Names** to control which measures appear in a crosstab
- **Debugging why a filter doesn't affect a FIXED LOD** — refer to the Order of Operations section

---

## Tableau Order of Operations (Filter Evaluation Order)

Filters don't all run at the same time. This order explains why a dashboard filter may not affect a FIXED LOD calculation:

1. Extract Filters
2. Data Source Filters
3. **Context Filters** ← runs before FIXED LOD
4. Sets / Top N / **FIXED LOD Expressions**
5. **Dimension Filters** ← standard quick filters
6. INCLUDE / EXCLUDE LOD Expressions
7. **Measure Filters**
8. Table Calculations
9. Table Calc Filters
10. Trend / Reference Lines

**Key takeaway:** a standard dimension filter (step 5) runs *after* FIXED LOD (step 4). To make a filter scope a FIXED LOD calculation, it must be a context filter (step 3).

---

## Filter Types

### Categorical Filter

Use to include or exclude specific dimension members.

**Add:** drag a dimension to the **Filters** shelf → select **Use all**, **Select from list**, **Custom value list**, or **Use all** → OK.

**Include specific values:** check the members you want to keep.

**Exclude values:** switch the dialog to **Exclude** mode — useful for filtering out "Other" or "N/A" members.

### Date Filter

Date fields offer two filter modes in the dialog:

| Mode | What it does |
|---|---|
| **Relative date** | Rolling window: last N days/weeks/months/years, anchored to today |
| **Range of dates** | Fixed start and end date |
| **Years / Quarters / Months / Weeks / Days** | Discrete date part filter — pick which years or months to include |

Dragging a date to Filters and choosing a discrete date part (e.g., Year) creates a categorical filter on that part — useful for "show only 2024 and 2025".

Choosing "Range of dates" creates a continuous date range filter with a date slider.

### Continuous Range Filter (Measures)

Drag a measure to **Filters** → select an aggregation → set the range (at least, at most, range, or special).

Used to filter to values above a threshold (e.g., Sales > $10,000) or within a range.

### Top N Filter

Limits a dimension to its top or bottom N members ranked by a measure.

**⇒ Wrong-fork check:** need to KEEP the other rows (tag them into groups, e.g. roll the middle into an "Everyone Else" bar), not remove them? A Top-N filter *removes* rows; a **SET** *tags* membership. That's a set, not a filter. See [Membership vs. Value](data/knowledge/strategy/analytics/calc-fields-strategy.md#membership-vs-value). Use the Top N filter below only when you genuinely want the other members GONE.

**Add:** drag a dimension to Filters → go to the **Top** tab → select **By field** → set N and the measure.

Top N runs in the same order-of-operations slot as FIXED LOD (step 4). To scope it to a context (e.g., top 10 per region), make the scoping filter a context filter.

**Table calc approach for Top N:** create an `INDEX()` or `RANK()` calc with the desired Compute Using, then add a table calc filter on that field (keep INDEX <= N). Table calc filters run at step 9 — after all aggregation — so they respect the full view without needing context.

### Context Filter

Context filters run at step 3, before FIXED LOD and Top N. Make any filter a context filter when:
- A FIXED LOD should be scoped by the filter
- A Top N filter should apply within the context of another filter

**Make a filter a context filter:** right-click the filter pill in the Filters shelf → **Add to Context**. The pill turns gray.

Context filters apply to the extract/data source first, so they can improve query performance by reducing the dataset size before downstream calculations run.

### Cross-Sheet Filter (Apply to Worksheets)

A filter on one worksheet can control other worksheets on the same dashboard.

**Set up:** add the filter control to the dashboard → click the dropdown arrow on the filter control → **Apply to Worksheets** → choose **Selected Worksheets** or **All Using This Data Source**.

The filter then appears in the Filters shelf of the target worksheets automatically. Each target worksheet evaluates the filter independently based on its own view structure.

**Important:** Cross-sheet filters only work when all worksheets share the same data source (or a related source). If a target worksheet uses a different data source, the filter won't appear as an option.

### Measure Names / Values Filter

In a multi-measure crosstab using Measure Names and Measure Values, add Measure Names to the Filters shelf to control which measures appear.

Select the measures to include from the list. This is equivalent to choosing which measures to show in the Measure Values card.

---

## Filter Controls on Dashboards

Drag a filter control from a worksheet to the dashboard, or click the dropdown on any sheet → **Filters** to add a control.

**Control types** (right-click the control on the dashboard → **Customize**):
- Single value (dropdown)
- Single value (list)
- Single value (slider)
- Multiple values (dropdown)
- Multiple values (list)
- Multiple values (custom list)
- Wildcard match

**Compact controls** (single row dropdowns) are best for top-bar filter layouts. Full list controls are better for right-sidebar layouts where vertical space is available.

---

## Best Practices

- **Use context filters when a FIXED LOD or Top N must be scoped by another filter.** Standard dimension filters run after FIXED LOD — they won't affect it.
- **Use table calc filters (INDEX/RANK) for flexible Top N.** Unlike the native Top N dialog, a table calc filter respects all other filters and gives full control over partitioning.
- **Choose the right date filter mode for the use case.** Relative date ("Last 12 months") is better for always-current dashboards; Range of dates is better for fixed reporting periods.
- **Be specific about what Cross-Sheet filters apply to.** "All Using This Data Source" can unexpectedly filter unrelated worksheets on the dashboard. Prefer "Selected Worksheets" for surgical control.
- **Keep filter controls close to the content they control.** A filter placed far from the chart it affects confuses users about what it does.

---

## Common Mistakes

1. **FIXED LOD not responding to a dashboard filter.** Standard dimension filters run at step 5, after FIXED LOD at step 4. Fix: right-click the filter → Add to Context.
2. **Top N showing wrong results when combined with another filter.** If the other filter is a dimension filter (step 5), it runs after Top N (step 4). The top N is computed on the unfiltered set. Fix: make the scoping filter a context filter, or switch to a table calc approach.
3. **Cross-sheet filter not appearing in another worksheet.** The target worksheet must use the same data source (or a related one). Check that the target sheet's data source matches, and that "Apply to Worksheets" includes it.
4. **Date filter showing wrong granularity.** If you wanted to filter by a date range but got a year list instead, you chose a discrete date part in the filter dialog rather than "Range of dates." Reopen the filter, select the field again, and choose Range of dates.
5. **Exclude filter accidentally removing nulls.** When excluding specific members, Tableau's default behavior also excludes nulls. Use **Special** tab in the filter dialog to explicitly include or exclude nulls as needed.
6. **Applying a measure filter when a table calc filter was needed.** Measure filters (step 7) run before table calculations (step 8), so a measure filter on a field derived from a table calc may not work as expected. Filter on the table calc result at step 9 instead using a table calc filter.

---

## Implementation

Use the sections above as the implementation reference for Tableau authoring. Apply the relevant pattern in the workbook or dashboard, then verify the result in Tableau for correctness, readability, and customer-safe behavior.

## Source and Confidence

- Source/evidence type: published documentation
- Source: Tableau order of operations, filter dialog patterns, and context-filter behavior from the Tableau knowledge base
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-03
