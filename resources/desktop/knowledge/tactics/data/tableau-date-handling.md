# Tableau Date Handling in Workbook XML

Confirmed patterns for date fields, date truncation, fiscal year offsets, custom date calculations, and DATEPARSE in Tableau workbook XML. All patterns validated via `get-workbook-xml` observation.

**Core principle: prefer native date derivations over calculated fields.** Tableau's column-instance derivation system (`yr:`, `wk:`, `tmn:`, etc.) covers the vast majority of date granularity needs — year, quarter, month, week, day, hour — with a single CI and no calculated field. Native derivations produce correct labels automatically, participate in Tableau's date hierarchy, and keep the datasource clean. Only reach for a `DATEPART`/`DATEADD` calculated field when the derivation system genuinely can't express what you need (e.g. day-of-year integers for a cross-year overlay axis).

---

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: create, calculate, validate
- In-scope reason: Helps Claude prefer native date derivations over calculated fields and avoid date-handling pitfalls when authoring Tableau date fields.
- Out-of-scope risk: none
- Tags: dates, date-derivations, datetrunc, dateparse, fiscal-year
- Relevant user prompts/search terms: "date on columns gaps disappear", "discrete date missing periods", "continuous date axis spacing", "fiscal year offset datasource", "DATEPARSE live SQL returns null", "YYYYMMDD integer to date cast", "MONTH vs DATETRUNC month difference", "day of year overlay chart", "TruncatedToMonth keeps year", "derivation prefix wrong after add-field", "dates missing on my axis", "why are dates missing", "date axis has gaps"

## When to Use

Use this module when you need to:
- **Place a date field** on a shelf with a specific granularity (Year, Quarter, Month, Day, etc.)
- **Show dates as continuous** (axis) vs. **discrete** (row/column headers)
- **Apply fiscal year offsets** to a date dimension
- **Parse a string column as a date** using DATEPARSE
- **Debug date filtering or truncation** that's producing unexpected labels or empty views
- **Build relative date calculations** (days since, date diff, rolling windows)

---

## Best Practices

- **Default to native derivations, not calculated fields**: before writing a `DATEPART`/`DATETRUNC` calc, check whether a derivation CI (`wk:`, `mn:`, `tyr:`, etc.) already expresses what you need. Native derivations produce correct labels, require no column def in the datasource, and keep the workbook simpler.
- **Default to continuous (`qk`) when a date is on Columns**: discrete headers compress missing periods — a week with no data simply disappears from the axis, making gaps invisible. Continuous axes preserve true spacing so gaps show up as breaks in the line. Switch to discrete only when you explicitly want uniform column headers (e.g. a crosstab or small-multiple trellis).
- **Always use `TruncatedTo*` derivations for continuous date axes**, not `None` (exact date) — exact date creates a mark per row, which usually means thousands of marks and an unreadable viz.
- **For DATEPARSE, verify source type first**: DATEPARSE does not work on live SQL connections — it silently returns null. Check connection type before authoring.
- **Fiscal year start belongs on the datasource node, not on individual fields**.
- **Distinguish a date *part* from a *truncation* deliberately**: `MONTH()` / discrete `Month` collapses every year into 12 buckets (seasonality); `DATETRUNC`/`TruncatedToMonth` keeps year and gives a real timeline. Pick based on whether the user wants months combined across years or a continuous timeline.
- **Never put an integer `YYYYMMDD` key straight on a date axis** — cast it to a real date first (parse the digits or `DATEPARSE`), and keep the integer column for filtering/joining.

---

## Common Mistakes

1. **Assuming all continuous dates use `TruncatedTo*` derivations**: `Quarter` and `Week` use the same derivation string for both discrete and continuous — only the `:ok`/`:qk` suffix differs. `TruncatedToWeek` and `TruncatedToQuarter` are not valid.
2. **Using discrete date on Columns**: discrete derivations only render headers for periods that have data — missing weeks vanish. Use the continuous equivalent.
3. **Writing a calculated field for something a derivation CI already handles**: e.g. `DATEPART('week', ...)` is unnecessary when `[wk:Order Date:ok]` with `derivation="Week"` does the same thing with better labels.
4. **Using continuous truncation but expecting discrete headers**: `tmn:Order Date:qk` creates a continuous axis, not "January / February / March" headers.
5. **DATEPARSE on a live SQL connection**: silently returns null. Use `CAST` in custom SQL instead.
6. **Wrong `date_part` quotes**: `DATEDIFF(day, ...)` fails; must be `DATEDIFF('day', ...)`.
7. **Guessing the fiscal year CI prefix**: `fyr:` and `fqr:` only work if the datasource has `fiscal-year-start` set.
8. **Using a `MONTH()` date *part* when you meant a month *truncation*** — the part collapses all years into 12 buckets (see "Cross-year month rollup" below). If the user expects Jan 2024 and Jan 2025 to be separate points, that's `DATETRUNC`/`TruncatedToMonth`, not `MONTH()`.
9. **Treating an integer `YYYYMMDD` key as a date** — it sorts/filters like a number and renders as integers on an axis, not a date. Cast it (see "Integer date keys" below).

---

## Implementation

### Discrete vs. Continuous

| Form | CI suffix | `type` attr | Shelf behavior |
|---|---|---|---|
| Discrete (blue pill) | `:ok` | `ordinal` | Row/column headers per period |
| Continuous (green pill) | `:qk` | `quantitative` | Continuous axis |

### Common derivation prefixes

| Granularity | Discrete CI | Continuous CI | Derivation string |
|---|---|---|---|
| Year | `[yr:Date:ok]` | `[tyr:Date:qk]` | `Year` / `TruncatedToYear` |
| Quarter | `[qr:Date:ok]` | `[qr:Date:qk]` | `Quarter` (same for both) |
| Month | `[mn:Date:ok]` | `[tmn:Date:qk]` | `Month` / `TruncatedToMonth` |
| Week | `[wk:Date:ok]` | `[wk:Date:qk]` | `Week` (same for both) |
| Day | `[dy:Date:ok]` | `[tdy:Date:qk]` | `Day` / `TruncatedToDay` |

**Default: use continuous when a date goes on Columns.** Use continuous (`:qk`, `type="quantitative"`) unless you explicitly need uniform column headers. This applies to derivation CIs and DATEPART calcs alike.

### Workflow for adding a date to a shelf

1. Identify the column's internal name via `list-available-fields`.
2. If going on Columns, default to continuous unless discrete headers are explicitly needed.
3. Add a `column-instance` to `datasource-dependencies` with correct `name`, `derivation`, `pivot="key"`, and `type`.
4. Reference the CI on the shelf: `[datasourceId].[ci-name]`.
5. Read back the worksheet XML and verify the `derivation` attribute is capitalized (e.g. `"Month"`, not `"mn"`).

### YoY running sales pattern

Day-of-year is not available as a native derivation — use `DATEPART('dayofyear', ...)` as a calculated field with `role="dimension" type="quantitative"` for a continuous integer axis. Pair with `RUNNING_SUM(SUM([Sales]))` on Rows and Year (discrete) on Color.

```xml
<column name="[Calculation_DayOfYear]" caption="Day of Year"
        role="dimension" type="quantitative" datatype="integer">
  <calculation class="tableau" formula="DATEPART('dayofyear', [Order Date])" />
</column>

<column name="[Calculation_RunningTotalSales]" caption="Running Total Sales"
        role="measure" type="quantitative" datatype="real">
  <calculation class="tableau" formula="RUNNING_SUM(SUM([Sales]))" />
</column>

<column-instance name="[yr:Order Date:ok]" column="[Order Date]"
                 derivation="Year" pivot="key" type="ordinal" />

<cols>[datasource].[Calculation_DayOfYear]</cols>
<rows>[datasource].[Calculation_RunningTotalSales]</rows>
<!-- color: [datasource].[yr:Order Date:ok] -->
```

### Cross-year month rollup: `MONTH()` part vs month truncation

A dimension built from the **date part** `MONTH([Order Date])` (or the discrete `Month` derivation, `[mn:Order Date:ok]`) produces **12 month-name buckets that aggregate across all years** — January 2024 and January 2025 collapse into one "January". That is correct and intended for seasonality views (compare months irrespective of year), but it is a silent bug when the user expected a continuous timeline.

A **month truncation** — `DATETRUNC('month', [Order Date])` or the continuous `TruncatedToMonth` derivation `[tmn:Order Date:qk]` — **preserves the year**, so the same data renders as 24 month-year points (Jan 2024, Jan 2025, …).

Decision rule:
- Want one point per calendar month name, all years combined (seasonality)? → date **part** (`Month` / `[mn:…:ok]`).
- Want a real timeline, each month-year distinct? → **truncation** (`TruncatedToMonth` / `[tmn:…:qk]`).

If you must overlay multiple years on a single shared month axis (year on color, months aligned), synthesize a fixed-year date so all years map to the same 12 positions, e.g. `DATE("2024-" + RIGHT("0" + STR(MONTH([Order Date])), 2) + "-01")` on Columns with a `%B` month-name format, and put `[yr:Order Date:ok]` on Color. (This is the month-level analogue of the day-of-year overlay above.)

### Integer date keys (`YYYYMMDD`)

Warehouses (Snowflake, BigQuery, Databricks, Postgres, SQL Server) commonly store dates as integers like `20240115`. Tableau treats that column as a **number**: it sorts/filters numerically and, on a continuous axis, renders integer values instead of a date timeline.

Keep the integer column as-is in the datasource (it is useful for fast filtering/joining) and derive a real date where you need a date axis, by parsing the digits into an ISO date:

```
// DATEPARSE (fails silently on live SQL connections — see Best Practices):
DATEPARSE("yyyyMMdd", STR([Order Date Key]))

// Portable form that works regardless of connection type:
DATE(LEFT(STR([Order Date Key]), 4) + "-" + MID(STR([Order Date Key]), 5, 2) + "-" + RIGHT(STR([Order Date Key]), 2))
```

`MID()` is 1-indexed (position 5 starts the month). Build the derived date as a calculated field on the datasource, then add date-granularity derivations (`tmn:`, `yr:`, …) on top of *that* field, not the integer key.

### Tool-generated derivation bug

The `add-field` tool may write the CI prefix as the `derivation` attribute (e.g. `derivation="mn"`) instead of the required capitalized string (`derivation="Month"`). Tableau silently falls back to the raw date field. Always read back and verify after adding a date field.

---

## Source and Confidence

- Source/evidence type: field-tested
- Source: Tableau workbook XML inspection via `get-workbook-xml`, SE team field experience
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-05-05
