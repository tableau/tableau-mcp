# LOD & Table-Calc Pattern Cookbook

A solution cookbook of advanced LOD and table-calculation patterns: for each business question, the copy-pasteable formula, the Compute Using / addressing setup, and the gotchas that bite in practice.

It assumes the mechanics (what FIXED/INCLUDE/EXCLUDE mean, addressing vs. partitioning, the order-of-operations pipeline) are already known — see [Calculated Fields, Parameters & Table Calculations](data/knowledge/strategy/analytics/calc-fields-strategy.md) for those. Field names follow Sample - Superstore.

**⇒ Wrong-fork check:** using RANK/LOD to assign GROUP MEMBERSHIP (tag rows Top/Bottom/Everyone-Else, to color them or drive a click/parameter action)? That's a **SET**, not a calc — the calcs here are for a displayed ordinal *value*. See [Membership vs. Value](data/knowledge/strategy/analytics/calc-fields-strategy.md#membership-vs-value).

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: calculate, create, validate
- In-scope reason: Gives Claude the worked LOD/table-calc recipe for a stated business question (cohort, YoY, Pareto, rank-within-group, sparkline labels), closing the gap between "knows the calc syntax" and "knows which pattern solves this analysis."
- Out-of-scope risk: none
- Tags: lod, fixed, include, exclude, table-calculations, compute-using, running-total, lookup, rank, pareto, cohort, percent-of-total, sort-dependence, addressing, week-anchoring, rank-direction
- Relevant user prompts/search terms: "share of total that ignores filters", "percent of total", "running total", "running sum wrong order when I re-sort", "table calc changes when I sort", "compute using / addressing", "year over year growth", "moving average", "rank within group", "does RANK default ascending or descending", "top N per category", "cohort retention", "first purchase date", "average daily sales per month", "histogram of customer spend", "deduplicate join fan-out", "keep grand total while showing top 10", "Tableau week starts Sunday or Monday" "RFM segmentation", "RFM score calculation", "recency frequency monetary", "customer segmentation formula", "how do I score customers 1 to 5", "champions at risk churned segment labels"

## When to Use

Use this guide when a user asks for an analytical result that needs an LOD expression or a table calculation and you need the exact formula plus the addressing/Compute Using setup — for example "show each category's share of company-wide sales even when filtered," "rank states within each region," "year-over-year growth," "top 3 products per category," or "average daily sales per month." For the underlying mechanics and the full order-of-operations pipeline, see [workbook-calc-fields.md](data/knowledge/strategy/analytics/calc-fields-strategy.md).

## Best Practices

### Which tool, which keyword

**LOD keyword decision tree:**

```
Need a grain INDEPENDENT of the view (won't change as users add/remove dims)?
├─ YES → FIXED                         {FIXED [dim] : AGG()}
│        ⚠ ignores dimension filters (runs before them) — add filter to CONTEXT to honor it
└─ NO  (grain should track the view)
   ├─ Need a FINER grain than the view, then roll up?   → INCLUDE  {INCLUDE [finer dim] : AGG()}
   └─ Need a COARSER grain than the view (drop a dim)?   → EXCLUDE  {EXCLUDE [dim in view] : AGG()}
```

Quick tells:
- "...regardless of what the user filters/picks" → FIXED (+ context filter if it must still honor *some* filters).
- "average of a per-X total" (avg sales per customer) → INCLUDE the finer dim, re-aggregate in the view.
- "share of a higher level" / "vs. the category subtotal" → EXCLUDE the dim to roll past (or FIXED the level to divide by).
- A table-scoped LOD (no colon, e.g. `{MAX([Order Date])}`) = `{FIXED : ...}`; use for grand totals / latest-date constants.

**LOD vs. table calc:** Choose an **LOD** when you need a value computed on data *not in the view*, a result independent of layout/sort, or one you can filter like a dimension; LODs become SQL and run server-side. Choose a **table calc** when the computation is *relative to other marks already in the view* (running total, rank, % of total, period-over-period) or is positional/directional. Rule of thumb: reduce with LODs at the source; do positional math with table calcs on the reduced result.

### Classic LOD patterns

**Cohort / acquisition (first purchase date):**
```
[First Purchase Date]   {FIXED [Customer Name] : MIN([Order Date])}
[Cohort]                DATETRUNC('month', [First Purchase Date])
[Months Since Acq]      DATEDIFF('month', [First Purchase Date], [Order Date])
```
Retention curve: `[Months Since Acq]` (continuous) on Columns, `COUNTD([Customer Name])` on Rows, `[Cohort]` on Color — one line per cohort, all starting at month 0. FIXED on `[Customer Name]` is essential: it must ignore `[Order Date]` to anchor the cohort, and survives date-range filtering because FIXED runs before dimension filters.

**New-customer trend (don't double-count repeats):**
```
[Is Acquisition Order]  [Order Date] = {FIXED [Customer Name] : MIN([Order Date])}
[New Customers]         COUNTD( IF [Is Acquisition Order] THEN [Customer Name] END )
```
Each customer is counted once, in their acquisition period.

**Percent of total that ignores filters (fixed denominator):**
```
SUM([Sales]) / MIN({FIXED : SUM([Sales])})
```
Keeps the percentage constant under quick filters. Contrast with the table-calc `SUM([Sales]) / TOTAL(SUM([Sales]))`, which *recalculates* to the filtered subset. Scope the denominator by listing dims inside FIXED: `SUM([Sales]) / MIN({FIXED [Category] : SUM([Sales])})` = each sub-category's share of its own category.

> **Use `MIN()` (or `MAX`/`AVG`/`ATTR`), not `SUM()`, to aggregate a fixed denominator.** A dimensionless `{FIXED : SUM([Sales])}` is a grand-total *constant replicated onto every underlying row*; wrapping it in `SUM()` adds it up once per row feeding the mark, so on data with many rows per category the denominator inflates by the row count. `MIN`/`MAX`/`AVG`/`ATTR` collapse the identical replicated constant back to the single correct value. (Examples that use `SUM` only work when the data is already aggregated to one row per mark — don't rely on that.) **Verify by opening in Tableau on a multi-row-per-category extract** before trusting either form.

**Daily average within a month (avg of a finer grain):**
```
{INCLUDE DATETRUNC('day',[Order Date]) : SUM([Sales])}
```
Drop on Rows and change aggregation to AVG. Computes daily totals, then averages them up to the month — different from bare `AVG([Sales])`, which averages line items.

**Deduplicated counts (collapse a join fan-out):**
```
[Dedup Order Total]   SUM({FIXED [Order ID] : MIN([Order Total])})
```
The inner FIXED collapses to one value per order; the outer SUM rolls up correctly. On the logical/relationship model (2020.2+) this is often unnecessary — check the model first.

**Average of a per-entity maximum (nested LOD):**
```
AVG( {FIXED [Sales Rep] : MAX([Deal Size])} )
```
The legal way to write `AVG(MAX(...))`, which is illegal as bare nested aggregates. Order matters — MAX inside, AVG outside.

**"Last N periods" without losing the grand total:**
```
[Total All Time]      {FIXED : SUM([Sales])}                                  // immune to date filter
[Last 6 Months Flag]  DATEDIFF('month', [Order Date], {MAX([Order Date])}) < 6
```
Put the flag on Filters = True; `[Total All Time]` was computed by FIXED *before* the filter, so the KPI stays full-history while the view shows only recent periods.

### Classic table-calc patterns

For every pattern, **Compute Using / addressing is load-bearing** — the right formula with the wrong direction is silently wrong.

| Question | Formula | Compute Using |
|---|---|---|
| Running total | `RUNNING_SUM(SUM([Sales]))` | Table (Across); for multi-year, partition by Year + address Month to restart |
| YoY / prior-period growth | `(SUM([Sales]) - LOOKUP(SUM([Sales]),-1)) / ABS(LOOKUP(SUM([Sales]),-1))` | Across for prior-period; address Year / partition Month for YoY |
| Moving (trailing) average | `WINDOW_AVG(SUM([Sales]), -2, 0)` | Table (Across); offsets relative to current mark |
| Percent of total | `SUM([Sales]) / TOTAL(SUM([Sales]))` | Table (Down) = whole column; Pane (Down) = within pane |
| Rank within partition | `RANK(SUM([Sales]))` (or `RANK_DENSE`/`RANK_UNIQUE`) | address the ranked dim, partition the group |
| Index to 100 (rebase) | `SUM([Sales]) / LOOKUP(SUM([Sales]), FIRST()) * 100` | Table (Across) per series |
| Difference from previous | `SUM([Sales]) - LOOKUP(SUM([Sales]), -1)` | Table (Across) |

**Pareto / cumulative % (80/20)** — the calc:
```
RUNNING_SUM(SUM([Sales])) / TOTAL(SUM([Sales]))
```
Apply as Running Total → secondary Percent of Total, Compute Using = Table (Across); descending sort is mandatory. The full dual-axis build (bars + line, reference lines) is in [Advanced Chart Build Recipes](data/knowledge/strategy/viz-design/advanced-chart-builds.md) — that entry owns the build; this owns the calc.

**Top-N within each group (nested table calc):**
```
[Rank in Category]   RANK_UNIQUE(SUM([Sales]))
```
Compute Using = Sub-Category, partition by Category. Drag `[Rank in Category]` to Filters, keep `1 to 3`. As a **table-calc filter** it runs last and doesn't disturb the ranks. Use `RANK_UNIQUE` (not `RANK`) so a "1 to N" filter returns exactly N rows. For a nested formula like `RANK(WINDOW_AVG(SUM([Sales]),-2,0))`, set each level's direction in the Nested Calculations dropdown.

**Sparkline min/max labeling:**
```
[End Label]  IF LAST() = 0 THEN SUM([Sales]) END
[Max Label]  IF SUM([Sales]) = WINDOW_MAX(SUM([Sales])) THEN SUM([Sales]) END
```
Drop on Label; Tableau shows the value only where the condition is non-null. On float measures use `ROUND()` both sides or `ABS(a-b) < epsilon` to dodge floating-point inequality.

**Display few, total all (the "keep the grand total" trick):**
```
INDEX() <= 10        // table-calc filter, runs AFTER totals
```
A normal Top-N dimension filter removes rows before totals and shrinks the total; an `INDEX()`/`RANK()` table-calc filter executes after totals and reference lines, so grand totals reflect all rows.

**Histogram of an aggregate (bins on a computed value):**
```
[Customer Spend]  {FIXED [Customer Name] : SUM([Sales])}
[Spend Bin]       FLOOR([Customer Spend] / 1000) * 1000
```
`Create → Bins` only works on a raw measure, not an aggregate/table calc. Collapse to the entity grain with a FIXED LOD, then bin with `FLOOR(x/size)*size`.

### Addressing and sort-dependence: simple vs. needs-explicit-config

**Every table calc depends on addressing (Compute Using) and the view's sort — none is sort-independent.** The real split is not "robust vs. fragile" but how much addressing you must configure explicitly: some are *correct under the default* (Table-Across or a single-dimension partition), others *require* Specific Dimensions or boundary config or they silently give the wrong answer. Even the "correct under default" group still moves if the view's sort changes — so pinning the sort is part of correctness for all of them.

Two facts that govern every table calc:

- **Cumulative and rank calcs follow the view's sort.** `RUNNING_*`, `RANK*`, `INDEX()`, and `LOOKUP()` accumulate/rank in the order marks appear, which is set by the *worksheet sort* (`<computed-sort>` "sort dim X by measure Y"), not by the formula. Re-sorting the viz changes the answer. For a Pareto, the descending sort is part of the calc's correctness, not cosmetics — pin it. If the sort measure isn't itself on the view, the sort still has to target it (a hidden companion field), or the running order is wrong.
- **`RANK*` defaults to descending.** `RANK(SUM([Sales]))` ranks largest = 1. State the direction explicitly when you mean ascending; this is a frequent off-by-direction bug when porting from engines that default ascending.

**Correct under the default addressing (Table-Across or a single-dim partition is enough) — but still sort-dependent, so pin the sort:** `RUNNING_SUM/AVG/MAX/MIN/COUNT`, `WINDOW_SUM/AVG/MAX/MIN/COUNT/STDEV` with trailing bounds `(-n, 0)`, `RANK`, `RANK_DENSE`, `RANK_PERCENTILE`, `INDEX`, `LOOKUP(agg, ±n)`, unbounded `TOTAL`/`WINDOW_SUM` for share-of-total. The default Compute Using yields the intended result here *for a single addressing dimension*; it does not make these immune to a sort change (see the Pareto note above).

**Require explicit addressing — set Specific Dimensions and verify, or expect surprises:** `WINDOW_MEDIAN/PERCENTILE/CORR/COVAR/VAR/STDEVP`, `PREVIOUS_VALUE`, `SIZE()`, `FIRST()`/`LAST()` (including as window bounds), `RANK_UNIQUE`/`RANK_MODIFIED`, **shifted windows** (`WINDOW_*(agg, 1, 3)` — bounds that don't include the current mark), restart-every / pane-relative / compute-along-a-non-axis-dim addressing, and **multi-dimension partitions** beyond a single split. None of these are wrong, but their result depends entirely on Compute Using — never trust the default.

### Week anchoring is Sunday in Tableau

Tableau's week truncation and `DATEPART('weekday', …)` are **Sunday-anchored** (Sunday = 1), regardless of the warehouse's week-start convention (Snowflake defaults to Monday). A `RUNNING_SUM` or week-over-week `LOOKUP` along a week axis aligns to Sunday weeks; if the underlying warehouse rolls weeks on Monday, the week boundaries differ. When week alignment matters, derive the week start explicitly — e.g. `DATEADD('day', 1 - DATEPART('weekday', [Order Date]), [Order Date])` for a Sunday-aligned week start — rather than assuming the source agrees.

## Common Mistakes

- **FIXED ignores dimension filters** — it runs before them, so FIXED denominators/totals stay constant under quick filters. To honor a filter, Add to Context; to honor all normal filters, rewrite as INCLUDE/EXCLUDE.
- **General + Top-N filters fight** (same pipeline step) — make the qualifying filter a context filter so "Top 10 in City X" works.
- **Table calcs only see marks in the view** — a dimension filter shrinks what `RUNNING_SUM`/`LOOKUP`/`RANK` can see; period-over-period breaks if intermediate periods are filtered out. Use a table-calc filter or convert to a FIXED/INCLUDE LOD.
- **Compute Using is silent state** — `INDEX()`, `RANK()`, `RUNNING_*`, `LOOKUP()` change when you re-sort or move pills. Pin Specific Dimensions and verify after layout edits.
- **Partition-edge nulls** — `LOOKUP(...,-1)` and windowed offsets return Null at first/last marks. Wrap in `ZN()`/`IFNULL()` when you need 0.
- **`TOTAL` vs `WINDOW_SUM`** — `TOTAL(SUM(x))` aggregates the underlying rows; `WINDOW_SUM(SUM(x))` sums the displayed marks. Identical in flat layouts, divergent under nested addressing.
- **`[Sales] - AVG([Sales])` errors** ("cannot mix aggregate and non-aggregate") — wrap the constant in an LOD: `[Sales] - {FIXED : AVG([Sales])}`.
- **No `FIRST_VALUE`/`LAST_VALUE` function** — use `LOOKUP(SUM([Sales]), FIRST())`.
- **`RANK` drops ties in Top-N counts** — use `RANK_UNIQUE` so "1 to N" returns exactly N rows.
- **FIXED on high-cardinality dims is expensive** — each generates a `GROUP BY` sub-query; prefer INCLUDE that rolls into the existing query, or pre-aggregate at the source.
- **Relationship model changes the numbers** — on the logical model (2020.2+) tables aggregate at native grain before combining, so manual FIXED-dedup may be unnecessary, and an LOD written for a joined model can over/under-count on a related model.
- **Assuming `RANK` is ascending** — it defaults to descending (largest = rank 1). Pass the direction explicitly when porting logic that expects ascending.
- **Assuming weeks roll on Monday** — Tableau weeks are Sunday-anchored; a week axis or week-over-week calc won't match a Monday-week warehouse unless you derive the week start explicitly.
- **Shifted/`FIRST()`/`LAST()`/percentile windows treated like trailing windows** — these depend on exact addressing and partition edges; set Specific Dimensions and verify rather than relying on Table-Across defaults.

## Implementation

When a user states a business question, classify it first: is the needed value independent of the view (LOD) or relative to the marks on screen (table calc)? Pick the matching pattern above, paste the formula, then state the required Compute Using/addressing explicitly — it is the most common silent-failure point. For percent-of-total and ranking, confirm whether the result should stay constant under filters (LOD/FIXED) or follow the visible marks (table calc) before choosing. Validate against a real workbook: a table calc that renders is not necessarily computing across the intended partition.

## Related Knowledge

- Extends [Calculated Fields, Parameters & Table Calculations](data/knowledge/strategy/analytics/calc-fields-strategy.md): that entry covers the mechanics and the full order-of-operations pipeline; this entry is the worked-recipe layer above it.
- Relates to [Tableau Date Handling](data/knowledge/tactics/data/tableau-date-handling.md) and [Year-over-Year Comparison](data/knowledge/tactics/viz/workbook-date-yoy-comparison.md): the YoY/period-over-period recipes here pair with those date entries.


## RFM Segmentation (Recency/Frequency/Monetary) via FIXED LOD

RFM (Recency, Frequency, Monetary) is a customer segmentation technique used in CRM and sales analytics. All three base metrics are per-account LOD expressions.

**Context:** assumes a datasource with fields like `[Account Name]`, `[Close Date]`, `[Stage]`, `[Opportunity ID]`, `[Amount]`.

### Base metric calculations

```
Recency (Days Since Last Won):
DATEDIFF('day', { FIXED [Account Name] : MAX(IF [Stage] = 'Closed Won' THEN [Close Date] END) }, TODAY())

Frequency (Won Deals):
{ FIXED [Account Name] : COUNTD(IF [Stage] = 'Closed Won' THEN [Opportunity ID] END) }

Monetary (Won Revenue):
{ FIXED [Account Name] : SUM(IF [Stage] = 'Closed Won' THEN [Amount] ELSE 0 END) }
```

### Scoring (1–5 scale, range-based)

**R Score** — lower days = higher score (most recent = 5):
```
INT(5.0 - 4.0 * ([Recency (Days)] - {FIXED: MIN([Recency (Days)])})
    / NULLIF(FLOAT({FIXED: MAX([Recency (Days)])} - {FIXED: MIN([Recency (Days)])}), 0))
```

**F Score** — higher frequency = higher score:
```
INT(1.0 + 4.0 * ([Frequency (Won Deals)] - {FIXED: MIN([Frequency (Won Deals)])})
    / NULLIF(FLOAT({FIXED: MAX([Frequency (Won Deals)])} - {FIXED: MIN([Frequency (Won Deals)])}), 0))
```

**M Score** — higher revenue = higher score:
```
INT(1.0 + 4.0 * ([Monetary (Won Revenue)] - {FIXED: MIN([Monetary (Won Revenue)])})
    / NULLIF(FLOAT({FIXED: MAX([Monetary (Won Revenue)])} - {FIXED: MIN([Monetary (Won Revenue)])}), 0))
```

**Combined Score** (string): `STR([R Score]) + STR([F Score]) + STR([M Score])`

### Segment label

```
IF [R Score] >= 4 AND [F Score] >= 4 AND [M Score] >= 4 THEN "Champions"
ELSEIF [R Score] <= 2 AND [F Score] >= 3 AND [M Score] >= 3 THEN "At Risk"
ELSEIF [R Score] <= 2 AND [F Score] <= 2 THEN "Churned"
ELSEIF [R Score] >= 4 AND [F Score] <= 2 THEN "Promising"
ELSEIF [R Score] <= 2 AND [M Score] >= 4 THEN "Can't Lose Them"
ELSEIF [R Score] >= 3 AND [F Score] >= 3 THEN "Loyal Customers"
ELSEIF [R Score] >= 3 AND [M Score] >= 3 THEN "High Value"
ELSE "Needs Attention"
END
```

**Scoring formula notes:**
- R Score inverts because fewer days since last order = higher score: `5 - 4 * (value - min) / range`
- F and M Scores are direct: `1 + 4 * (value - min) / range`
- `NULLIF(..., 0)` guards against divide-by-zero when all accounts have identical values
- The inner `{FIXED: MIN(...)}` and `{FIXED: MAX(...)}` reference the per-account LOD result fields, giving distribution-aware cutoffs

---

## Source and Confidence

- Source/evidence type: external reference (adapted with permission)
- Source: adapted from `plugin-tableau-master` (`references/lod-and-table-calc-cookbook.md`) by Jon Plax, used with the author's permission
- Customer-identifying details removed: n/a
- Confidence: draft
- Last reviewed: 2026-06-19

## Runtime Classification

- Knowledge type: authoring-expertise
- Runtime visibility: server-side-only
- Version binding: none
- Customer customization allowed: no
- Tool/API dependency: none
- Eval candidate: yes
- Eval coverage: none
- Promotion target: authoring-expertise
