# Prior-Year Calcs That Respond to the Date Filter — the Order-of-Operations Trap

A current-year-vs-prior-year measure only "changes based on the date filter" if the prior-period value is computed at a pipeline step the filter can actually reach, and only stays correct if it references **real date derivations** instead of an invented field. The classic failures: a `FIXED` prior-period value ignores the date filter (runs before it), a `LOOKUP` prior-period value returns null once the comparison year is filtered out of the view, and an agent references a date field or derivation that does not exist in the datasource. This entry is the calc-correctness half of a YoY build; for the year-overlay chart shape, see the year-over-year comparison companion.

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: calculate, create, troubleshoot
- In-scope reason: Shows how to build a current-vs-prior-period measure that recomputes with the date filter (context filter for FIXED, table-calc caveats, DATEADD prior period) using valid date derivations, and how to avoid the hallucinated-date-field baseline failure.
- Out-of-scope risk: none
- Tags: prior-period, prior-year, current-vs-prior, dateadd, date-filter, order-of-operations, context-filter, lookup, relative-date, valid-date-derivations, anchor-date
- Relevant user prompts/search terms: "current year vs prior year calculation that changes based on the date filter", "make my YoY recompute when I change the date filter", "prior year sales with DATEADD", "prior period returns null when I filter to one year", "context filter for the prior-year comparison", "my FIXED prior year ignores the date filter", "this year vs last year measure that follows the filter", "current period vs prior period calc", "prior-year value is blank after filtering dates", "year over year calc uses a field that does not exist"

## When to Use

Use this when the requirement is a **calculated** current-vs-prior comparison whose result must move with the user's date filter — for example "current year vs prior year that updates when I change the date range," "this year vs last year as a measure," or "prior period % change that respects the filter." It is the how-do-I-compute-it partner to the how-do-I-chart-it overlay:

- Compute the comparison value → this entry (order of operations, DATEADD, valid derivations).
- Render both years as separate series on one axis → the year-over-year comparison companion below.

## Best Practices

1. **Base every period on a real date derivation, never an invented field.** Use native derivations of the actual date column (`[yr:Order Date:ok]` for year, `[tmn:Order Date:qk]` for a month timeline) or `DATEADD`/`DATETRUNC`/`YEAR()` on the real field. Do NOT reference a `[Year]`, `[Prior Year Sales]`, or `[none:Order Date:qk]`-style field that isn't in the schema — verify the date field exists first. A hallucinated field is the baseline YoY failure: the calc errors or the viz renders blank.
2. **Decide the prior-period mechanic before writing it.** Two correct shapes:
   - **`LOOKUP` (table calc)** — `SUM([Sales]) - LOOKUP(SUM([Sales]), -1)` addressed along Year. Follows the marks in the view.
   - **`DATEADD`/conditional (aggregate calc)** — split current vs prior with the real date, e.g. `SUM(IF DATETRUNC('year',[Order Date]) = DATETRUNC('year',[Anchor Date]) THEN [Sales] END)` for current and the `DATEADD('year',-1,…)` window for prior.
3. **Make it respond to the filter at the right step (the trap).** Tableau's order of operations decides whether a date filter reaches your comparison value:
   - A **relative/range date filter is a dimension filter** (it runs *after* `FIXED` LODs). A prior-period value built with a `FIXED` LOD therefore **ignores** that filter. Fix: right-click the date filter → **Add to Context** so it runs before the LOD.
   - A **`LOOKUP` table calc runs late but only sees marks left in the view.** If the filter removes the prior year's marks, `LOOKUP(-1)` has nothing to look back to and returns null. Fix: keep the comparison period in the view (e.g. a relative filter of the **last 2 years**) and hide/limit display separately, rather than filtering the prior year out.
   - Full evaluation order and the context-filter fix: see the filter-strategy companion below.
4. **Anchor "current" to the data, not to `TODAY()`.** In a static extract, `TODAY()` is years past the data, so "this year" returns nothing. Anchor to `{MAX([Order Date])}` (or the user's stated reporting date).
5. **Prefer a relative date filter for "always current."** "Last 2 years" keeps both the current and prior period available so the comparison never loses its baseline as data advances.

## Common Mistakes

1. **`FIXED` prior-period value that won't respond to the date filter.** Dimension filters run after `FIXED`; add the date filter to Context (or rebuild as a table calc) so the comparison recomputes.
2. **`LOOKUP(SUM(...), -1)` returns null after filtering to one year.** The prior year's marks were filtered out of the view. Keep both years in view; filter display, not the comparison window.
3. **Referencing a date field or derivation that doesn't exist.** The single biggest YoY failure — build the year/prior-year from the real date column's derivations, not a guessed field name.
4. **Using a `MONTH()` date *part* when a month *truncation* was meant.** The part collapses every year into 12 buckets, so "this year vs last year by month" loses the year split. Use `TruncatedToMonth` / `[tmn:…:qk]` when years must stay distinct (see the date-handling companion).
5. **Hardcoding a year literal (`YEAR([Order Date]) = 2024`).** It won't advance with the data. Anchor to `{MAX([Order Date])}` and derive current/prior from it.

## Implementation

1. Confirm the real date field and measure exist (list the available fields); pick native derivations over new calcs where possible.
2. Choose the mechanic: `LOOKUP` table calc for a view-relative comparison, or a `DATEADD`/conditional aggregate calc for a filter-scoped value.
3. If using a `FIXED`-based comparison and it must follow the date filter, **Add the date filter to Context**.
4. If using `LOOKUP`, ensure the comparison period stays in the view — use a relative filter (e.g. last 2 years) rather than filtering the prior year away.
5. Anchor "current" with `{MAX([Order Date])}` (or the stated reporting date), not `TODAY()`.
6. Verify by changing the date filter: the current and prior values should both move, and neither should go blank; read back the XML to confirm only valid date derivations are referenced.

## Related Knowledge

- `expertise://tableau/tactics/viz/workbook-date-yoy-comparison` — the year-overlay chart shape (year on color, month on axis); pair the calc here with that view.
- `expertise://tableau/strategy/viz-design/filter-strategy` — the full filter order of operations and the Add-to-Context fix.
- `expertise://tableau/tactics/data/tableau-date-handling` — native date derivations, `DATEADD`/`DATETRUNC`, avoiding invalid date fields.
- `expertise://tableau/tactics/data/lod-and-table-calc-patterns` — the `LOOKUP`-based prior-period growth recipe and its addressing.
- `expertise://tableau/tactics/data/period-over-period-calcs` — a parameter-switched period selector (month/quarter/year) via `DATEDIFF` from the max date.

## Source and Confidence

- Source/evidence type: internal-doc synthesis
- Source: consolidated from this repo's date-handling, filter-strategy, LOD/table-calc, and year-over-year expertise modules; order-of-operations and DATEADD prior-period behavior are standard Tableau calculation semantics
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-07-05
