# Period-over-Period: a Parameter-Switched Profit-by-Period Calc (DATEDIFF from max date), NOT a date filter

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, troubleshoot
- In-scope reason: Shows the DATEDIFF-from-max-date relative-window technique and blocks the invalid derivation form that crashes on load.
- Out-of-scope risk: none
- Tags: period, period-over-period, month-quarter-year, relative-date, datediff, max-date, anchor-date, parameter-switched-period, profit-by-period, time-window, latest-period, period-selector-calc, make-the-period-selectable, period-switch, selectable-period, re-rank-per-period, CONTAINS-not-equals
- Relevant user prompts/search terms: "switch the measure between this month, quarter, and year", "show profit for the latest month / quarter / year", "let me pick the period and the chart updates", "relative date window anchored to the most recent date", "period over period without a date filter", "DATEDIFF from the max date", "how do I make Month/Quarter/Year a parameter that drives the numbers", "make the period selectable", "add a parameter to switch the profit between the most recent Month, Quarter, and Year", "have the chart re-rank for the selected period", "click to change the period and re-sort the chart", "the standouts should change between periods"

## When to Use

Enforced-by: invalid-column-instance-pivot

Use this when a requirement is **"show the measure for the selected period (month / quarter / year)"** and the period is chosen by a parameter — a common "top/bottom performers for the selected period" pattern. The period is expressed as a **row-level calc that keeps a row's value only when it falls in the chosen window relative to the latest date** — it is NOT a worksheet date filter and NOT a column-instance like `[none:Order Date:qk]` (that reference is invalid and crashes the load — see `invalid-column-instance-pivot`).

**⇒ Wrong-fork check (the load-reject trap):** do NOT write `IF ( [Param] = "Month" AND … ) OR ( [Param] = "Quarter" AND … ) OR … THEN [Profit] END`. A list/string parameter compared with `=` inside a bare `IF ( … OR … )` boolean chain makes Tableau's loader coerce the parameter into a boolean slot, and the load is REJECTED with **"value 'Quarter' neither 'false' nor 'true'"** (a query-time load failure, invisible in XML that "looks" fine; repeated re-applies can destabilize Desktop). Use the branch form below — **`CONTAINS([Parameters].[Period], "Year")`** in a proper `IF … ELSEIF … ELSE … END`, not `=` in an OR-chain. And the interactivity half (click-to-set / re-rank per period) is a SEPARATE concern → [parameter-driven-views](data/knowledge/tactics/dashboard/parameter-driven-views.md): one parameter drives both display and the click action, and you MUST verify the chart actually changes per period (a view that looks identical for every value doesn't read the parameter).

## Best Practices

1. **Anchor to the data's own latest date with an LOD, not "today".** `Max Date = {MAX([Order Date])}` — a FIXED-style anchor so the window is relative to the data, reproducible in a static extract like Sample-Superstore (where "this month" means the most recent month present, not the calendar month).
2. **Express each period as a row-level DATEDIFF window, returning the measure or NULL.** `DATEDIFF('<grain>', [Order Date], [Max Date]) = 0` is true exactly when the row is in the same grain-bucket as the latest date. Wrap the measure in `IF … THEN [Profit] END` so out-of-window rows drop out.
3. **Switch the grain with the parameter via CONTAINS, in one calc.** A single period measure reads the period parameter and picks the matching window — so every downstream view (chart, KPI, tier) recomputes from this one field when the parameter changes. This is the period SPINE (one calc, many consumers) — see `tactics/dashboard/parameter-driven-views`.
4. **Build top/bottom membership off the period measure, not raw Profit**, so the standouts re-rank per period (LOD `{ INCLUDE [Sub-Category]: SUM([Period Measure]) }` — using the real dimension name, not a placeholder).

## Common Mistakes

1. **Reaching for a date FILTER (or a `[none:Order Date:qk]` reference) to "filter to the period."** A dimension instance cannot be `:qk`; the reference is rejected on load ("field … does not exist") and repeated re-applies can destabilize Desktop. Use the row-level DATEDIFF calc instead — no date field goes on a shelf or filter at all.
2. **Anchoring to `TODAY()`/`NOW()` in a static dataset.** Sample-Superstore's latest date is years in the past, so "this month" relative to today returns nothing (blank viz). Anchor to `{MAX([Order Date])}`.
3. **One calc per period placed separately (Month sheet, Quarter sheet, Year sheet).** That's the N-static-copies anti-pattern and it can't be parameter-switched — collapse to one period-measure calc the parameter drives.
4. **Forgetting the `END` / leaving the ELSE branch off** so non-window rows return 0 instead of NULL — 0s still draw bars; NULL drops them.

## Implementation in Tableau Desktop

Confirmed-working calcs (generic Superstore fields — substitute your measure/date and parameter names, keeping each name consistent everywhere it is referenced):

```
Max Date       = {MAX([Order Date])}

Period Measure =
  IF     CONTAINS([Parameters].[Period], "Year")    THEN (IF DATEDIFF('year',   [Order Date],[Max Date])=0 THEN [Profit] END)
  ELSEIF CONTAINS([Parameters].[Period], "Quarter") THEN (IF DATEDIFF('quarter',[Order Date],[Max Date])=0 THEN [Profit] END)
  ELSE                                                    (IF DATEDIFF('month',  [Order Date],[Max Date])=0 THEN [Profit] END) END
```

1. Author `Max Date` (an LOD; registers as a row-level-usable attribute).
2. Author the period measure (`Period Measure` here — name it whatever you like, consistently) referencing `Max Date` and the `[Period]` parameter (a string list parameter: members `"Month"`, `"Quarter"`, `"Year"`, default `"Month"`). **Use `CONTAINS([Parameters].[Period], "Month")`, NOT `[Parameters].[Period] = "Month"` inside a bare `IF ( … OR … )` — the `=` form makes the loader coerce the string parameter into a boolean slot and the load is rejected with "value 'Quarter' neither 'false' nor 'true'".**
3. Put `SUM([Period Measure])` on the shelf where the measure goes; the chart now follows the parameter.
4. Verify by switching the parameter: the totals and the bar lengths change per period; no `<filter>` on a date field appears in the readback.

## Related Knowledge

- `tactics/dashboard/parameter-driven-views.md` — the parameter is the spine; one calc, many consumers; the click-to-set action.
- `tactics/data/tableau-date-handling.md` — DATEDIFF grains and date semantics.
- `tactics/data/sets-usage-and-creation.md` — top/bottom membership off the period measure.
- `invalid-column-instance-pivot` (validation rule) — guards the crashing `[none:<date>:qk]` form this pattern replaces.

## Source and Confidence

- Source/evidence type: field-tested
- Source: Transcribed from a WOW2021 W44 published workbook (confirmed-working Max Date + DATEDIFF window calcs)
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-07-03
