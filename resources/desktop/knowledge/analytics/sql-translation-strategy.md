# SQL to Tableau Calculation Translation

Strategy guide for deciding how a piece of SQL should be re-expressed in Tableau: the FIXED-LOD-vs-table-calc judgment, the equal-count-vs-equal-width bucketing tradeoff, and when to refactor SQL out of the datasource.

---

## When to Use This Module

Use this guide when:

- **Refactoring a custom SQL datasource** so each SQL computed column becomes a Tableau calculated field
- **A customer asks "how do I express this SQL in Tableau?"**
- **Porting windowed ranking, date arithmetic, or CASE logic** from SQL into a Tableau workbook
- **Explaining the FIXED LOD vs. table calc decision** to a customer familiar with SQL window functions

For line-by-line SQL-to-Tableau lookup tables and XML formula escaping rules, see `expertise://tableau/tableau-tactics/data/sql-translation`.

---

## The Two Questions That Decide Every Translation

Before looking up a single function, the SQL construct itself tells you which Tableau primitive to use. Almost every translation reduces to two questions.

1. **Does the result change as the viz is re-sliced?** A SQL `GROUP BY` aggregate is stable at its grain. It should become a `FIXED` LOD, evaluated at the grain you name regardless of what is on the shelves. This mirrors `GROUP BY` semantics: the value is attached at the entity level and does not drift as the view is filtered or dimensioned.
2. **Is the result inherently relative to other rows?** A SQL window function, such as `OVER (PARTITION BY ... ORDER BY ...)`, rank, running total, lag, or lead, is positional and should become a table calculation. Table calcs run on the aggregated data visible in the view, so the answer depends on the shelves. That is correct for windowed analysis but wrong for anything that should be partition-agnostic.

Scalar SQL such as casts, string concatenation, date math, and `CASE` is the easy case: it maps one-to-one to a scalar Tableau function with no grain implications.

Practical consequence: when in doubt between a `FIXED` LOD and a table calc, prefer the LOD for anything that must stay stable, because a table calc silently breaks when the view layout changes.

---

## NTILE: Equal-Count vs. Equal-Width

SQL `NTILE(k)` has no direct Tableau equivalent, and the choice of approximation is a semantic decision, not a mechanical one:

- **Range-mapping** such as `INT(1 + 4 * (value-min)/range)` produces equal-width buckets. It is simple but skews badly when the distribution is lopsided; a few outliers can leave whole buckets empty.
- **LOD `PERCENTILE` cutoffs** produce true equal-count-ish distribution cutoffs that better match SQL `NTILE` semantics and are the right default for quintile/decile segmentation such as RFM.

Pick equal-count with PERCENTILE unless the customer specifically wants fixed-width bands. Either way, compute the per-entity value first with an inner `FIXED` before bucketing so high-transaction entities are not over-weighted.

For actual range-mapping and PERCENTILE formulas, see `expertise://tableau/tableau-tactics/data/calc-fields` and `expertise://tableau/tableau-tactics/data/sql-translation`.

---

## Nested LODs: Evaluation Order as a Design Tool

Tableau evaluates LODs inside-out, and that ordering makes entity-then-distribution scoring possible. An inner per-entity `FIXED` collapses each customer or account to one value, and an outer table-scoped `FIXED` with no dimension then takes the global aggregate over those entity values.

Recognizing this two-stage shape is the key strategic insight for translating any aggregate-of-an-aggregate SQL, such as average of per-customer totals or percentile of per-account revenue.

---

## Translation Decision Rules

When you have a SQL expression to translate, apply these rules in order:

1. **`GROUP BY` aggregation** -> FIXED LOD with the GROUP BY dimension(s)
2. **`OVER (PARTITION BY ... ORDER BY ...)` window function** -> table calc with Compute Using set to the partition dimension
3. **Scalar expression** such as cast, string concat, date math, or CASE -> equivalent scalar function
4. **`NTILE(k)` exact equal-count buckets** -> LOD PERCENTILE cutoff pattern
5. **`NTILE(k)` approximate equal-width buckets** -> range-mapping formula
6. **`LAG`/`LEAD`** -> `LOOKUP()` table calc, with Compute Using set to the ordering field

---

## Best Practices

- **Default to FIXED LOD over table calc for GROUP BY translations.** FIXED matches GROUP BY semantics exactly: result depends only on the FIXED dimensions, not on the current view layout.
- **Use `ZN()` for `COALESCE(x, 0)`.** It is idiomatic and the Tableau query optimizer recognizes it.
- **Use `DATEDIFF` and `DATEADD` for date math.** Explicit unit parameters such as `'day'` and `'month'` handle edge cases correctly.
- **Break complex nested LODs into named intermediate fields.** A `{ FIXED [Customer] : MAX([Order Date]) }` is clearer as `[Last Order Date per Customer]` referenced by downstream calculations.
- **Set Compute Using explicitly for all table calc translations.** The default Compute Using is often wrong; always verify the partitioning.

---

## Common Mistakes

1. **Using NTILE range-mapping and assuming equal-count buckets.** Range-mapping yields equal-width. Use the LOD PERCENTILE pattern for true equal-count segmentation behavior.
2. **Translating a `PARTITION BY` window function to a FIXED LOD when table calc semantics are needed.** `SUM(x) OVER (PARTITION BY y)` is a running window and should be a table calc, not a FIXED LOD.
3. **Forgetting Compute Using for LAG/LEAD.** `LOOKUP(SUM([X]), -1)` without setting Compute Using lags along the wrong dimension, usually table-down instead of the date dimension.
4. **Using caption names in formulas instead of the actual field names.** Field names in Tableau are what appears in the Data pane. If a field was renamed in the Data pane, use the renamed version; for workbook XML internals, follow the naming rules in `expertise://tableau/tableau-tactics/data/calc-fields`.
5. **Forgetting to guard divide-by-zero in range-mapping.** `NULLIF(denominator, 0)` prevents errors when all values are identical and the range is 0.

---

## Implementation

This is a classification workflow, not a transcription exercise:

1. **Classify the SQL construct** using the two questions above: stable aggregate (`GROUP BY`), positional window (`OVER`), or plain scalar.
2. **Choose the Tableau primitive from that class** before worrying about exact syntax: `FIXED` LOD, table calc, or scalar function.
3. **Resolve the semantic forks** such as equal-count vs. equal-width for `NTILE`, and entity grain vs. transaction grain for any aggregate-of-aggregate.
4. **Look up the exact function and Compute Using** in `expertise://tableau/tableau-tactics/data/sql-translation`, naming intermediate LODs for clarity.
5. **Validate against the source.** Build a side-by-side comparison so the translated calc's totals and breakdowns match the original SQL before relying on it.

---

## Source and Confidence

- Source/evidence type: SME-authored reference
- Source: SQL-to-Tableau translation best practice (GROUP BY -> LOD, window-function mapping) from SE consulting experience
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
