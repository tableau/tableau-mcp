# Rolling-Period & Previous-Value Table Calcs — Windows, Adjacent Windows & LOOKUP Along the Date

A rolling-12-month total, a "same rolling window a year ago," a "previous value," and a "change over the period the user picks" are one primitive: a **table calculation that walks along the date marks in the view**. Because a table calc runs late and only sees the marks left after filtering, its **addressing (Compute Using) and partition are load-bearing** and its result is only as complete as the window kept in the view. This is the moving-window / `LOOKUP` half of period comparison; the calc-that-must-respond-to-the-date-filter half (order of operations, `DATEADD`, valid date derivations) is the year-over-year companion, and the parameter-switched Month/Quarter/Year selector is the period-over-period companion.

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: calculate, create, troubleshoot
- In-scope reason: Gives the correct mechanic and addressing for rolling-window aggregates (rolling 12-month current vs prior year, adjacent rolling windows), previous-value references (`LOOKUP(-1)`/`PREVIOUS_VALUE`), and "change over varying/selected periods," including the partition-edge nulls and marks-in-view limits that make these silently wrong.
- Out-of-scope risk: none
- Tags: rolling-window, moving-window, rolling-12-months, trailing-window, window-sum, window-avg, lookup, previous-value, prior-value, adjacent-windows, addressing, compute-using, partition-edge-null, varying-time-periods, offset
- Relevant user prompts/search terms: "rolling 12 months current year compared to rolling 12 months prior year", "rolling 12-month against the next rolling 12-month", "compare two adjacent rolling 12 month windows", "trailing 12 months vs prior 12 months", "table calculation previous value", "reference the previous period's value", "LOOKUP minus one previous value", "show change over varying time periods", "moving window sum along the date", "rolling window returns null at the start", "my rolling total restarts on the wrong dimension", "previous value is blank on the first row", "window sum wrong when I re-sort"

## When to Use

Use this when the requirement walks along a **date axis in the view** and reads other marks:

- A **rolling / trailing window** (rolling 12 months, moving sum/average) and a comparison of it to the **same window a year earlier** or to an **adjacent** window (e.g. Feb2023–Feb2022 vs Feb2022–Feb2021).
- A **previous-period value** (`LOOKUP(SUM(x), -1)`), a difference-from-previous, or an index-to-first.
- **"Change over varying/selected time periods,"** where the *comparison window* is positional. If the user wants to *pick* the grain (Month/Quarter/Year) and drive the whole view, that is the parameter-switched period spine — see the period-over-period companion; if the comparison value must **recompute from the date filter itself**, see the year-over-year companion.

## Best Practices

1. **A rolling window is `WINDOW_SUM`/`WINDOW_AVG` with explicit bounds, addressed along the date.** Trailing 12 months *including* the current month is `WINDOW_SUM(SUM([Sales]), -11, 0)` — eleven back plus current, **not** `-12`. Set Compute Using to the date dimension via **Specific Dimensions** in any view with more than one dimension; the Table/Pane default guesses and restarts on the wrong dimension the moment a second dimension is present.
2. **Rolling current-year vs prior-year — pick the mechanic deliberately.** Two correct shapes: (a) a **table-calc offset** — `WINDOW_SUM(SUM([Sales]),-11,0) - LOOKUP(WINDOW_SUM(SUM([Sales]),-11,0), -12)` addressed along month, which requires all comparison months to be present in the view; or (b) a **`DATEADD`/`DATEDIFF` aggregate** that flags rows in the trailing-12 window ending at the anchor date vs the trailing-12 ending a year earlier, which survives a date filter better because it is not positional. Anchor "current" to `{MAX([Order Date])}`, not `TODAY()`, in a static extract.
3. **Adjacent rolling windows require explicit addressing.** Two windows that abut (this trailing-12 vs the previous trailing-12) are **shifted windows** — `WINDOW_SUM(agg, -23, -12)` vs `WINDOW_SUM(agg, -11, 0)`, or two `DATEDIFF`-from-anchor row-level flags. Shifted windows (bounds that don't include the current mark) are in the "must set Specific Dimensions and verify" group — never trust the Table-Across default for them.
4. **"Previous value" is `LOOKUP(SUM([measure]), -1)`.** It addresses along the sort/date; there is no `FIRST_VALUE`/`LAST_VALUE` — use `LOOKUP(agg, FIRST())`/`LOOKUP(agg, LAST())`. `PREVIOUS_VALUE(seed)` is for a self-referencing running calc, not a generic prior-period read. **Partition edges return Null**: `LOOKUP(...,-1)` and windowed offsets are Null at the first/last marks — wrap in `ZN()`/`IFNULL()` only when a 0 is genuinely meant (a 0 draws a mark; a Null drops it).
5. **Table calcs only see the marks left in the view.** A dimension date filter that removes the comparison window breaks `LOOKUP`/rolling silently (the prior window has no marks to look back to). Keep the comparison window **in** the view with a relative filter (e.g. last 24 months) and limit *display* separately, or convert to a `FIXED`/`DATEADD` aggregate that is computed before the dimension filter.
6. **Pin the sort — every one of these follows the view's order.** `RUNNING_*`, `WINDOW_*`, `LOOKUP`, `INDEX` accumulate/step in the order marks appear, set by the worksheet sort, not the formula. A rolling window on an unsorted or descending date axis walks the wrong way; make the date sort explicit and ascending.

## Common Mistakes

1. **Trusting the default Compute Using** for a rolling/`LOOKUP` calc in a multi-dimension view — it restarts on the wrong dimension. Set Specific Dimensions to the date and verify.
2. **Filtering the prior window out of the view**, then `LOOKUP(-1)` / rolling PY returns Null. Keep both windows in view; filter display, not the comparison window.
3. **Off-by-one bounds** — trailing 12 months is `(-11, 0)`, not `(-12, 0)`; adjacent prior window is `(-23, -12)`.
4. **Using a date *part* (`MONTH()`) where a continuous value/truncation is needed** — a part collapses years into 12 buckets, so the window has no continuous order to walk (and years stop being distinct).
5. **N separate sheets per period** instead of one calc — can't be re-driven; for a *selectable* period use the parameter-switched period spine, not copies.
6. **Treating shifted / `FIRST()` / `LAST()` windows like trailing windows** — they depend entirely on addressing and partition edges; set Specific Dimensions and check the edge marks.

## Implementation

1. Classify the requirement: rolling/moving window, previous-value, or a *selectable* period (→ period-over-period companion).
2. Pick the mechanic: a positional table calc (`WINDOW_*`, `LOOKUP`) when the comparison is relative to marks in the view; a `DATEADD`/`DATEDIFF` aggregate when it must survive a date filter.
3. Set Compute Using **explicitly** along the date dimension; pin the date sort ascending.
4. Keep the comparison window in the view (relative last-N filter); handle edge Nulls with `ZN()`/`IFNULL()` only where a 0 is meant.
5. Anchor "current" to `{MAX([Order Date])}` in static extracts.
6. Verify by reading back numbers at the window edges (first period, the CY/PY boundary) — a table calc that renders is not necessarily walking the intended partition.

## Related Knowledge

- `expertise://tableau/tactics/data/lod-and-table-calc-patterns` — the `WINDOW_*`/`LOOKUP`/`RUNNING_*` recipe table, the addressing/sort-dependence split, partition-edge nulls, and the "no `FIRST_VALUE`/`LAST_VALUE`" rule.
- `expertise://tableau/tactics/data/period-over-period-calcs` — the parameter-switched Month/Quarter/Year period spine (`DATEDIFF` from `{MAX([Order Date])}`, `CONTAINS` not `=`) for a *selectable* period.
- `expertise://tableau/tactics/data/year-over-year-date-filter-calc` — the companion: a prior-period value that must recompute with the date filter (order of operations, `DATEADD`, valid date derivations).
- `expertise://tableau/tactics/data/table-calcs` — the XML shapes for Moving Average / window / Difference-From quick table calcs and Compute Using.
- `expertise://tableau/tactics/data/tableau-date-handling` — `DATEADD`/`DATETRUNC` grains and native date derivations.
- `expertise://tableau/tactics/viz/workbook-date-yoy-comparison` — the year-overlay chart shape to pair with these calcs.
- `expertise://tableau/strategy/viz-design/filter-strategy` — the full filter order of operations and why a dimension filter shrinks what a table calc can see.

## Source and Confidence

- Source/evidence type: internal-doc synthesis
- Source: consolidated from this repo's LOD/table-calc cookbook (window/`LOOKUP` addressing, partition-edge nulls, shifted-window caveats), period-over-period, and date-handling expertise modules; rolling-window, `LOOKUP`, and addressing behavior are standard Tableau table-calculation semantics
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-07-06
