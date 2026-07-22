# Translating SQL to Tableau Calculations

When refactoring a custom SQL datasource to native tables (see `expertise://tableau/tactics/data/datasources`), SQL-computed columns become Tableau calculated fields. This is the translation reference.

---

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, calculate
- In-scope reason: Maps SQL window functions, aggregations, and scalar expressions to Tableau calculated fields so Claude can refactor custom SQL datasources into native Tableau analytics.
- Out-of-scope risk: none
- Tags: sql-to-tableau, lod-expressions, window-functions, scalar-expressions, ntile-approximation, fixed-lod, table-calcs, rank-ceiling-quintile, percentile-cutoffs, nested-lod, date-arithmetic, coalesce-vs-zn
- Relevant user prompts/search terms: "SQL to Tableau translation", "GROUP BY to FIXED LOD", "NTILE equal-count buckets", "SQL window function Tableau equivalent", "RANK over ORDER BY", "COALESCE null handling", "date interval arithmetic DATEADD", "LAG function LOOKUP table calc", "SUM OVER partition WINDOW_SUM"

## Aggregations → FIXED LOD expressions

SQL aggregations with `GROUP BY` translate to Tableau FIXED LODs. The `GROUP BY` dimension becomes the FIXED dimension:

| SQL | Tableau |
|---|---|
| `SUM(sales) ... GROUP BY customer` | `{FIXED [Customer]: SUM([Sales])}` |
| `COUNT(DISTINCT order_id) ... GROUP BY customer` | `{FIXED [Customer]: COUNTD([Order ID])}` |
| `AVG(discount) ... GROUP BY customer` | `{FIXED [Customer]: AVG([Discount])}` |
| `MAX(order_date) ... GROUP BY customer` | `{FIXED [Customer]: MAX([Order Date])}` |
| `MIN(amount) ... GROUP BY region, category` | `{FIXED [Region], [Category]: MIN([Amount])}` |

---

## Scalar expressions

| SQL | Tableau |
|---|---|
| `CURRENT_DATE - date_col` | `DATEDIFF('day', [Date Col], TODAY())` |
| `col::INTEGER` (cast) | `INT([Col])` |
| `col1 \|\| col2` (string concat) | `STR([Col1]) + STR([Col2])` |
| `CASE WHEN x >= 4 THEN 'A' WHEN x <= 2 THEN 'B' ELSE 'C' END` | `IF [X] >= 4 THEN "A" ELSEIF [X] <= 2 THEN "B" ELSE "C" END` |
| `COALESCE(a, b, 0)` | `IFNULL([A], IFNULL([B], 0))` or `ZN([A])` (for null→0) |
| `EXTRACT(YEAR FROM date_col)` | `YEAR([Date Col])` |
| `date_col + INTERVAL '30 days'` | `DATEADD('day', 30, [Date Col])` |

---

## String functions

SQL string functions map to Tableau scalar string functions. Two differences bite most often: **Tableau has no `CONCAT` — use `+`** (and every non-string operand must be wrapped in `STR()`), and **all position/length arguments are 1-based** (`MID`, `FIND`, `LEFT` count from 1, not 0).

| SQL | Tableau | Notes |
|---|---|---|
| `col1 \|\| col2` / `CONCAT(a, b)` | `[A] + [B]` | No `CONCAT` function; `+` only. Wrap non-strings: `[Name] + " (" + STR([Id]) + ")"` |
| `SUBSTRING(str, start, len)` | `MID([Str], start, len)` | 1-based `start`; `len` optional (`MID([Str], 5)` → to end) |
| `LEFT(str, n)` / `RIGHT(str, n)` | `LEFT([Str], n)` / `RIGHT([Str], n)` | identical |
| `CHARINDEX(sub, str)` / `POSITION(sub IN str)` | `FIND([Str], sub)` | **arg order flips** (string first); returns `0` when not found |
| `LEN(str)` / `LENGTH(str)` | `LEN([Str])` | character count |
| `UPPER` / `LOWER` | `UPPER([Str])` / `LOWER([Str])` | identical |
| `TRIM` / `LTRIM` / `RTRIM` | `TRIM([Str])` / `LTRIM([Str])` / `RTRIM([Str])` | trims spaces only |
| `REPLACE(str, from, to)` | `REPLACE([Str], from, to)` | identical |
| `CONTAINS` / `LIKE '%x%'` | `CONTAINS([Str], "x")` | returns boolean |
| `str LIKE 'x%'` / `LIKE '%x'` | `STARTSWITH([Str], "x")` / `ENDSWITH([Str], "x")` | anchored match |
| `REGEXP_SUBSTR` / `REGEXP_EXTRACT` | `REGEXP_EXTRACT([Str], pattern)` | first capture group |
| `REGEXP_REPLACE(str, pat, rep)` | `REGEXP_REPLACE([Str], pat, rep)` | identical |
| `str REGEXP pat` / `RLIKE` | `REGEXP_MATCH([Str], pat)` | returns boolean |
| `SPLIT_PART(str, delim, n)` | `SPLIT([Str], delim, n)` | 1-based token index |
| `CAST(x AS VARCHAR)` | `STR([X])` | any type → string |
| `ISNULL(x, y)` (SQL Server 2-arg) | `IFNULL([X], [Y])` | 2-arg fallback; **not** `ISNULL` (Tableau `ISNULL` is 1-arg boolean) |

**What does NOT work:**
- `CONCAT([A], [B])` — there is no `CONCAT` function in Tableau; it errors. Use `[A] + [B]`.
- `"Order " + [Order Id]` where `[Order Id]` is numeric — `+` on mixed types errors. Wrap: `"Order " + STR([Order Id])`.
- Assuming `FIND` is 0-based or takes `(substring, string)` order — it is 1-based and takes `([Str], substring)`, the reverse of `CHARINDEX`.
- Treating Tableau `ISNULL([X])` as the SQL Server 2-arg `ISNULL(x, y)` — Tableau's is a 1-arg boolean test; use `IFNULL`/`ZN` for a fallback value.

---

## Window functions

SQL window functions have limited direct equivalents in Tableau. Key translations:

| SQL | Tableau | Notes |
|---|---|---|
| `NTILE(5) OVER (ORDER BY x DESC)` | Range-mapping formula (see below), or LOD `PERCENTILE` cutoffs (see `calc-fields.md`) | No direct NTILE equivalent |
| `ROW_NUMBER() OVER (ORDER BY x)` | `INDEX()` | Table calc, requires Compute Using config |
| `RANK() OVER (ORDER BY x)` | `RANK(SUM([X]))` | Table calc |
| `SUM(x) OVER ()` | `WINDOW_SUM(SUM([X]))` | Table calc |
| `LAG(x, 1) OVER (ORDER BY date)` | `LOOKUP(SUM([X]), -1)` | Table calc |

**NTILE approximation using range mapping:**
```
// NTILE(5) OVER (ORDER BY x DESC) — quintile 5 = highest
INT(1 + 4 * ([X] - {FIXED: MIN([X])})
    / NULLIF(FLOAT({FIXED: MAX([X])} - {FIXED: MIN([X])}), 0))
```
This maps values to 1-5 using min/max range. For inverse scoring (5 = lowest value): `INT(5 - 4 * (val - min) / range)`. `NULLIF(..., 0)` guards against divide-by-zero.

**Important:** NTILE range-mapping is an approximation, not exact. SQL NTILE assigns equal-count buckets; the range-mapping formula assigns equal-width buckets. For exact quintiles, use `RANK()` with `CEILING(RANK / (COUNT / 5))`, or — for distribution-based exact quantile cutoffs — use the LOD `PERCENTILE` pattern documented in `expertise://tableau/tactics/data/calc-fields`.

---

## Nested LOD expressions

Tableau evaluates LODs inside-out. A FIXED LOD can reference another FIXED LOD:

```
// "Days since last order per customer" — references a per-customer MAX
DATEDIFF('day', {FIXED [Customer]: MAX([Order Date])}, TODAY())
```

A table-scoped FIXED (no dimension) computes a global aggregate:
```
// Global min/max for range mapping
{FIXED: MIN([Per Customer Sales])}
{FIXED: MAX([Per Customer Sales])}
```

---

## XML for calculated fields

```xml
<column caption='Days Since Last Order' datatype='integer'
        name='[Calculation_20260414_001]' role='measure' type='quantitative'>
  <calculation class='tableau'
    formula='DATEDIFF(&apos;day&apos;, {FIXED [Customer]: MAX([Order Date])}, TODAY())' />
</column>
```

**XML escaping rules in formulas:**
- `'` → `&apos;` (inside string literals like `'day'`)
- `"` → `&quot;` (inside string literals)
- `>=` → `&gt;=`
- `<=` → `&lt;=`
- `>` → `&gt;`
- `<` → `&lt;`
- `&` → `&amp;`

For the full set of round-trip normalizations Tableau applies to formula text on save, see `expertise://tableau/tactics/data/round-trip-normalization`.

---

## When to Use

Read this module when you are:
- **Refactoring a custom SQL datasource into native tables.** Each SQL-computed column becomes a Tableau calculated field; this reference maps the common SQL idioms.
- **Porting a SQL-driven analytical query into Tableau-native form** (e.g. windowed rankings, COALESCE chains, date arithmetic, multi-table aggregates) and need the equivalent calc-field syntax.
- **Building a calc field whose semantics are most clearly expressed in SQL** and you want to translate rather than re-derive.

For pure Tableau calc-field authoring (column structure, parameters, table calc internals), see `expertise://tableau/tactics/data/calc-fields`. For the datasource-refactor workflow itself (custom SQL → native tables with `object-graph` + `relationships`), see `expertise://tableau/tactics/data/datasources`.

---

## Best Practices

- **Default to FIXED LOD over table calc when the SQL had a `GROUP BY`.** FIXED matches `GROUP BY` semantics exactly: result depends only on the dimensions in the FIXED clause, regardless of viz layout. Table calcs depend on the layout (rows/cols/partitioning), so they're more fragile across worksheets.
- **For SQL `NTILE(k)` exact-bucket-count semantics, prefer RANK + CEILING over range-mapping.** Range-mapping creates equal-width buckets, not equal-count. Quintile/decile RFM logic almost always wants the LOD `PERCENTILE` cutoff form; see `calc-fields.md` for the pattern.
- **Use `ZN()` instead of `COALESCE(x, 0)`** when the only fallback is zero — it's the idiomatic Tableau form and the optimizer recognizes it.
- **For date arithmetic, use `DATEDIFF` and `DATEADD`** rather than the `+ INTERVAL` SQL syntax. They're explicit about the unit (`'day'`, `'month'`, etc.) and handle DST/leap-year edge cases consistently.
- **Verify aggregate-inside-LOD legality against the Tableau version** before assuming a translation will compile. The LOD-legal aggregate set has expanded over the release history (e.g. `PERCENTILE` since 2020.2); see `calc-fields.md`.

---

## Common Mistakes

1. **Translating `NTILE(k)` literally with range-mapping and assuming exact quintile counts.** Range-mapping yields equal-width, not equal-count. Use `LOD PERCENTILE` cutoffs (in `calc-fields.md`) or `RANK / CEILING` for true equal-count buckets.
2. **Converting `SUM(x) OVER (PARTITION BY y)` to a FIXED LOD without realizing it's `WINDOW_SUM` over a partition.** FIXED with `[Y]` works only when the row-level grain matches; for true window-function semantics across viz partitions, you need a table calc with the right Compute Using.
3. **Translating `LAG(x, 1) OVER (ORDER BY date)` and forgetting Compute Using.** `LOOKUP(SUM([X]), -1)` is a table calc; without setting Compute Using to the date dimension, it'll lag along whatever the default partition is — usually wrong.
4. **Using captions in translated formulas.** SQL columns map to Tableau column `name` attributes (internal names like `[M_Q1_SLS]`), not captions. Author the translated formula with the internal name; Tableau will rewrite caption-authored formulas on save anyway (see round-trip normalization).
5. **Forgetting to escape `'`/`<`/`>`/`&` in the XML form of the formula.** SQL ports often have `'day'` literals or `<=`/`>=` comparisons; both must become entities (`&apos;day&apos;`, `&lt;=`, `&gt;=`) inside `formula="..."`.

---

## Implementation

The general workflow for translating a SQL view into Tableau:

1. **Identify the analytical intent of each SQL column.** Aggregate? Window function? Scalar transformation? CASE expression? Each maps to a different Tableau pattern (FIXED LOD, table calc, scalar function, IF expression).
2. **Pick the right Tableau primitive per column.** Use the tables above. Default rule: `GROUP BY` → FIXED LOD; `OVER (...)` → table calc; scalar → scalar function; `CASE` → `IF/ELSEIF/ELSE`.
3. **Author the calc field as a `<column>` with `<calculation>` child** in the data datasource. Use a `[Calculation_<digits>]` internal name and put the SQL-derived label in `caption`.
4. **Mirror the column def + a `<column-instance>` in each worksheet's `<datasource-dependencies>`** that uses the new calc. Aggregate calcs need `derivation="User"` and the `usr:` CI prefix.
5. **Apply with `apply-workbook`** and verify with `get-workbook-xml` and `list-available-fields`. If the field shows red in the Data pane after apply, check (a) the column `name` is in `[Calculation_<digits>]` form, (b) all referenced fields exist in the worksheet's `datasource-dependencies`, (c) the formula is using internal names rather than captions.
6. **For round-trip-stability concerns** (formulas getting rewritten by Tableau on save), see `expertise://tableau/tactics/data/round-trip-normalization`.

## Source and Confidence

- Source/evidence type: design best-practice
- Source: SQL-to-Tableau calc-syntax mapping (FIXED-LOD equivalents, scalar/window functions, XML escaping)
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
