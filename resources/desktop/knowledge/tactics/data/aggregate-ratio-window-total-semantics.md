# Ratios, Windows & Grand Totals: Aggregate in the Right Order

The single most common numeric-correctness bug in Tableau is aggregating in the wrong order. A ratio is `SUM(numerator) / SUM(denominator)` — **not** `AVG(numerator / denominator)`. A moving average or percent-of-total over a window operates on already-aggregated marks, so its addressing (Compute Using) is load-bearing. And a grand total of a calculated/ratio field does **not** sum the visible cells — Tableau recomputes the calc over all rows, which is why a total can look "wrong." Get the aggregation order and the total-aggregation setting right and these four asks are one idea.

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: calculate, troubleshoot, validate
- In-scope reason: Gives the correct aggregation order for ratios (SUM/SUM vs AVG-of-ratios), moving averages and percent-of-total over windows (addressing), and grand totals of calculated fields (Total using), so KPIs and totals compute correctly instead of silently wrong.
- Out-of-scope risk: none
- Tags: aggregate-ratio, ratio-of-sums, sum-over-sum, percent-of-total, window-sum, window-avg, moving-average, grand-total, total-using, aggregation-order, market-share, compute-using
- Relevant user prompts/search terms: "market share by dividing one value by another", "divide one measure by another correctly", "average of ratios vs ratio of sums", "moving average of a calculated percentage", "moving average of a ratio", "percent of total over a moving sum window", "WINDOW_SUM percent of total", "grand total not adding up correctly", "grand total wrong for a calculated field", "why is my ratio grand total wrong", "total using sum vs automatic", "my percentage total doesn't match", "surplus deficit grand total incorrect"

## When to Use

Reach for this whenever the number is a **ratio, a windowed aggregate, or a total of a calc** and the result looks off:

- "Market share = one value divided by another" (a ratio KPI).
- "Moving average of a percentage / ratio" (a window over a ratio).
- "Percent of total over a moving sum window" (a window numerator over a total denominator, addressing-sensitive).
- "The grand total doesn't add up" for a calculated field.

All four are aggregation-order problems, not formula-syntax problems.

## Best Practices

1. **A ratio is a ratio of sums, computed from aggregates.** Write `SUM([Numerator]) / SUM([Denominator])` — a calc that divides two aggregate expressions. This gives the correct blended rate at any level of detail because it sums the parts first, then divides.
2. **Never average row-level ratios unless that is literally the question.** `AVG([Numerator] / [Denominator])` weights every row equally and returns a different (usually wrong) number than `SUM/SUM`. Call out the choice before writing the formula; "market share / rate / share of X" almost always wants `SUM/SUM`.
3. **A share of a total: pick constant-under-filter or follows-the-marks deliberately.** `SUM([Sales]) / TOTAL(SUM([Sales]))` (table calc) recalculates to the filtered/visible set; `SUM([Sales]) / SUM({FIXED : SUM([Sales])})` holds the denominator constant under quick filters. Use `MIN`/`MAX`/`AVG`/`ATTR` (not `SUM`) to collapse a dimensionless `{FIXED : …}` grand-total constant, or a multi-row-per-mark denominator inflates by the row count.
4. **A moving average / window of a ratio operates on the aggregated ratio, and addressing decides correctness.** Define the ratio as an aggregate (`SUM(num)/SUM(den)`), then apply the window over it: `WINDOW_AVG( SUM([Num]) / SUM([Den]), -2, 0 )` with Compute Using set explicitly along the date. Decide up front: *average of the periodic ratios* (window the ratio) vs *ratio of the moving sums* (`WINDOW_SUM(SUM([Num]),-2,0) / WINDOW_SUM(SUM([Den]),-2,0)`) — they differ.
5. **Percent of total over a moving window = a windowed numerator over a total denominator, with stated addressing.** e.g. `WINDOW_SUM(SUM([Sales]), -11, 0) / TOTAL(SUM([Sales]))`. State the partition/addressing (which dimension the window runs along, which the total spans); the same formula with the wrong Compute Using is silently wrong. Pin the sort — running/window/rank calcs follow the view's sort order.
6. **A grand total of a calc is recomputed, not summed.** By default Tableau's total uses **Automatic**: it re-evaluates the field over all underlying rows in the partition. For a plain additive measure that equals the column sum; for a **ratio or aggregate calc** it does NOT equal the sum of the displayed cells (a ratio's total is the ratio of the totals). To control it, use **Analysis → Totals → Total using** and pick the aggregation the total should use (Sum, Average, Automatic, …) per field.

## Common Mistakes

1. **`AVG([a]/[b])` for a rate/share.** Averages row ratios instead of dividing the sums. Use `SUM([a]) / SUM([b])`.
2. **Windowing a naive AVG-of-ratios.** A moving average built on an already-wrong row-ratio compounds the error. Fix the ratio to `SUM/SUM` first, then window it.
3. **Leaving Compute Using on the default for a windowed/percent-of-total calc.** The default addressing may run the window along the wrong dimension. Set Specific Dimensions and verify; pin the view's sort.
4. **Expecting a ratio's grand total to be the sum of the visible percentages.** It won't be — the total recomputes the ratio over all rows. Use Total using (Sum) only when summing the displayed values is actually meaningful (it isn't for a ratio).
5. **`SUM({FIXED : SUM([Sales])})` as a denominator on multi-row data.** The dimensionless constant is replicated per row and re-summed, inflating the denominator. Collapse it with `MIN`/`MAX`/`AVG`/`ATTR`.
6. **A Top-N/dimension filter shrinking a grand total you wanted whole.** A dimension filter removes rows before totals; use an `INDEX()`/`RANK()` table-calc filter (runs after totals) to "display few, total all."

## Implementation

1. Classify the metric: ratio (rate/share), windowed aggregate (moving avg, % of total over a window), or total of a calc.
2. For a ratio, author `SUM([Numerator]) / SUM([Denominator])`; state whether the denominator should stay constant under filters (LOD) or follow the marks (`TOTAL`).
3. For a window over a ratio, define the ratio as an aggregate first, then wrap it in `WINDOW_AVG`/`WINDOW_SUM` and set Compute Using explicitly; decide average-of-ratios vs ratio-of-sums.
4. For percent-of-total over a moving window, combine the windowed numerator with the total denominator and pin both the addressing and the sort.
5. For a grand total that "doesn't add up," open Analysis → Totals → Total using and set the intended aggregation per field; remember Automatic recomputes rather than summing.
6. Validate on real rows: a calc that renders is not necessarily aggregating at the intended grain — check the number, not just the chart.

## Related Knowledge

- `expertise://tableau/tactics/data/lod-and-table-calc-patterns` — worked LOD/table-calc recipes (percent of total, moving average, `TOTAL` vs `WINDOW_SUM`, display-few-total-all) and the addressing/sort-dependence rules.
- `expertise://tableau/tactics/data/table-calcs` — the XML shapes for Percent of Total, Moving Average, and window/rank quick table calcs and Compute Using.
- `expertise://tableau/strategy/analytics/calc-fields-strategy` — the calc mechanics and the full order-of-operations pipeline this builds on.

## Source and Confidence

- Source/evidence type: internal-doc synthesis
- Source: consolidated from this repo's LOD/table-calc, table-calc XML, and calc-strategy expertise modules; aggregate-ratio, window addressing, and Total-using behavior are standard Tableau aggregation semantics
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-07-05
