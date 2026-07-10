# Year-over-Year and Performance Scope Date Comparisons

Focused guidance for building year-over-year (YoY) and Performance Scope date comparisons, so Tableau users compare the intended periods instead of reading a misleading raw time series.

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: create, validate
- In-scope reason: Helps Claude build correct YoY and period-scope comparisons instead of a misleading single timeline when a user asks to compare years, current month, previous month, prior year, or YTD.
- Out-of-scope risk: none
- Tags: dates, year-over-year, yoy, time-series, date-parts, month-alignment, period comparison, performance scope, current month, YTD
- Expected agent behavior: When asked for YoY by month, build a month-aligned, year-separated overlay; when asked for Performance Scope-style comparisons, make the comparison scope explicit (CM vs PM, CM vs PY, CYTD vs PYTD) rather than defaulting to one raw continuous date timeline.
- Relevant user prompts/search terms: "year over year", "YoY", "this year vs last year", "compare sales by month across years", "seasonal comparison", "current month vs previous month", "current month vs previous year", "CYTD vs PYTD", "performance scope"
- Suggested golden task: Build YoY Sales by month, then build a Sales Performance Scope comparison with CM vs PM, CM vs PY, and CYTD vs PYTD from a workbook that has Order Date and Sales.
- Safe refusal condition: n/a

## When to Use

Use this guidance when a user wants to compare a measure (e.g., Sales) for the **same months across different years** - for example "this year vs last year" or a seasonal month-by-month comparison - or when they ask for a named period comparison such as current month vs previous month, current month vs previous year, or current YTD vs previous YTD.

This applies to:

- Tableau users building monthly time comparisons
- Seasonal / period-over-period analysis
- Dashboards with a YoY trend line or clustered bars by month
- KPI or executive views that need explicit comparison-period semantics

## Best Practices

The defining idea of a YoY-by-month view: **split the date into a month part (for alignment) and a year part (for comparison)** — do not plot one continuous date.

- **Month on the axis (Cols) for alignment.** Use the discrete Month date part (`MONTH([Order Date])`, column-instance `[mn:Order Date:nk]`) or a truncated month (`DATETRUNC('month', [Order Date])`, column-instance `[tmn:Order Date:qk]`). Truncated month keeps a true continuous axis while still aligning months when Year is the comparison dimension.
- **Year on Color (or Detail/Path) for comparison.** Use the Year date part (`YEAR([Order Date])`, column-instance `[yr:Order Date:ok]`) so each year renders as its own comparable series.
- **Aggregate the measure.** Put `SUM([Sales])` (column-instance `[sum:Sales:qk]`) on Rows.
- **Optionally limit to the two most recent years** for "this year vs last year" (a relative date filter of the last 2 years) so the overlay stays readable.
- **Validate the workbook XML** references a year derivation AND a month/truncated-month derivation of the date, plus the aggregated measure — not a lone continuous exact date.
- **For Performance Scope-style requests, name the comparison scope.** Use clear labels or a parameter such as `Performance Scope` with values like `CM vs PM`, `CM vs PY`, and `CYTD vs PYTD`. Do not collapse these into a generic "Sales over time" chart.
- **Anchor "current" explicitly.** In live authoring, use the user's stated reporting date or the latest date in the datasource as the current period. If neither is safe to infer, ask. In offline eval/demo tasks, follow the prompt's stated anchor.
- **Separate current and comparison windows.** `CM vs PM` compares current-month sales to the previous month; `CM vs PY` compares current-month sales to the same month in the prior year; `CYTD vs PYTD` compares current year-to-date sales to the equivalent prior-year-to-date window.
- **Show both value and delta.** For KPI cards or executive summaries, include the current value, comparison value, absolute delta, and/or percent delta so the selected scope is visible.
- **Author the scope, do not defer it.** If the user asks you to build the Performance Scope comparison, the applied workbook should contain the `Performance Scope` selector or explicit calculated fields/labels for `CM vs PM`, `CM vs PY`, and `CYTD vs PYTD`. Do not merely say "you could add a parameter later."

Confirmed-working worksheet shape (Sales by month, one line per year):

```xml
<worksheet name='YoY Sales by Month'>
  <table>
    <view>
      <datasource-dependencies datasource='Sample'>
        <column-instance name='[sum:Sales:qk]' column='[Sales]' derivation='Sum' pivot='key' type='quantitative' />
        <column-instance name='[yr:Order Date:ok]' column='[Order Date]' derivation='Year' pivot='key' type='ordinal' />
        <column-instance name='[mn:Order Date:nk]' column='[Order Date]' derivation='Month' pivot='key' type='nominal' />
      </datasource-dependencies>
    </view>
    <panes>
      <pane>
        <mark class='Line' />
        <encodings><color column='[Sample].[yr:Order Date:ok]' /></encodings>
      </pane>
    </panes>
    <rows>[Sample].[sum:Sales:qk]</rows>
    <cols>[Sample].[mn:Order Date:nk]</cols>
  </table>
</worksheet>
```

### What does NOT work

A single raw continuous exact date (`[none:Order Date:qk]`, i.e. Order Date dropped as a continuous exact date) on Cols plots **one unbroken timeline across all years**. It does not overlay years, so a YoY comparison is impossible. This is the most common mistake on this task.

For Performance Scope requests, a simple YoY-by-month overlay is also incomplete when the user asked for multiple comparison scopes. It may answer `CM vs PY`, but it does not answer `CM vs PM` or `CYTD vs PYTD` unless those windows are represented explicitly.

## Common Mistakes

1. **Single continuous exact-date timeline.** Putting a raw continuous `[Order Date]` on Cols produces one line spanning all years instead of a year overlay.
2. **Year on the axis next to an exact date.** Double-encoding time (exact date + Year) breaks month alignment and clutters the axis.
3. **Forgetting to aggregate.** Leaving Sales un-aggregated yields one mark per row instead of monthly totals.
4. **Year on Color but exact date (not the Month part) on Cols.** The years won't align month-to-month, defeating the comparison.
5. **Treating all period requests as YoY.** Current month vs previous month and current YTD vs previous YTD are not the same question as a month-by-month YoY overlay.
6. **Hiding the selected comparison period.** If a KPI card shows a delta without the active scope label, users cannot tell whether they are seeing prior-month, prior-year, or YTD comparison.

## Implementation

1. Acknowledge the goal: compare the measure for the same months across years.
2. Place a Month part (or truncated month) of the date on Cols for alignment.
3. Place the Year part of the date on Color so each year is its own series.
4. Place `SUM([Sales])` on Rows.
5. (Optional) limit to the last two years for a clean "this year vs last year" read.
6. Validate the applied workbook XML contains a year derivation, a month/truncated-month derivation, and the aggregated measure — and not a lone continuous exact date.

For a Performance Scope-style KPI or worksheet:

1. Define or represent a `Performance Scope` selector with the required values: `CM vs PM`, `CM vs PY`, and `CYTD vs PYTD`.
2. Compute the current period and comparison period from the same date anchor.
3. Aggregate the measure over each window.
4. Display the active scope label alongside the current value and delta.
5. If the user has not specified the reporting date and the latest datasource date is not safe to use, ask before authoring.

Minimum acceptable workbook markers for a Performance Scope build:

- A parameter or calculated field name/label containing `Performance Scope` or `Comparison Scope`.
- Visible or calculated labels for all requested scopes: `CM vs PM`, `CM vs PY`, and `CYTD vs PYTD`.
- Aggregated measure logic for the current period and the comparison period.

## Related Knowledge

- Extends [Marks, Encodings & Chart Configuration](data/knowledge/strategy/viz-design/encoding-strategy.md): that entry covers continuous vs discrete dates generally; this one is the specific YoY-by-month overlay pattern.
- Relates to [Calculated Fields, Parameters & Table Calculations](data/knowledge/strategy/analytics/calc-fields-strategy.md): a Percent Difference table calc is an alternative way to express YoY once the year/month split is in place.
- Related audit: The committed Tableau skills archive intake audit under `docs/fable/` records the archive source and the decision to extend this entry rather than create a duplicate Performance Scope file.

## Source and Confidence

- Source/evidence type: internal-doc + external archive intake
- Source: consolidated Tableau authoring guidance for year-over-year date handling; Performance Scope vocabulary derived from the external Tableau skills archive in `<local-path>/Downloads/` (accelerator author Performance Scope reference, MIT License, copyright 2026 Antoine Laviron), summarized in this repo's own words during the 2026-06-15 intake audit
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-06-15
