# Tableau Calc Function Reference (gotchas that bite)

A by-family catalog of Tableau calculation functions, focused on the **behaviors that surprise authors** — not a syntax dump (the formula editor autocompletes signatures). Use it to pick the right function and avoid the silent-wrong-answer cases.


**Companions:** `expertise://tableau/tactics/data/calc-fields` (calc-field XML), `expertise://tableau/tactics/data/lod-and-table-calc-patterns` (LOD + window/table-calc behavior), `expertise://tableau/tactics/data/calc-null-and-evaluation-semantics` (NULL propagation through IF/ELSE).

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, troubleshoot
- In-scope reason: Prevents silent-wrong-answer calc errors (COUNT vs COUNTD, STDEV vs STDEVP, FIND index conventions) when Claude authors calculated fields.
- Out-of-scope risk: none
- Tags: functions, calc-functions, count, countd, stdevp, percentile, zn, ifnull, isnull, attr, datename, datepart, dateparse, split, find, log, lod, regex, username, ismemberof, function-reference
- Relevant user prompts/search terms: "which Tableau function for", "COUNT vs COUNTD", "ZN vs IFNULL", "does COUNT include nulls", "STDEV vs STDEVP", "sample or population standard deviation", "population vs sample stddev variance", "DATENAME vs DATEPART", "DATEPARSE returns null", "FIND returns 0", "SPLIT index base", "set membership IN", "USERNAME ISMEMBEROF row level security function", "ATTR meaning", "PERCENTILE function"

## When to Use

Reach for this when choosing a function for a calculated field and you want to avoid a known foot-gun: counting with/without nulls, null-handling helpers, population vs sample statistics, date-part vs date-name, string index conventions, set membership, or row-level-security identity functions. For *which calc pattern solves a business question*, use the cookbook companion; for *how the calc field is encoded in XML*, use calc-fields.

## Logical / conditional / null

- **`IIF(cond, t, f)`** and **`CASE WHEN`** are alternatives to `IF/THEN/ELSEIF/ELSE/END`; an `IF` with no `ELSE` returns NULL for unmatched rows. NULL handling through these chains is a real trap — see the null-semantics companion.
- **`ZN(x)`** → 0 when `x` is NULL (idiomatic for "treat missing as zero"). **`IFNULL(x, y)`** → `y` when `x` is NULL. **`IFERROR(x, y)`** → `y` on error. **`ISNULL(x)`** → boolean; distinct from `x = ''` (empty string is not NULL).
- **`ATTR(x)`** returns `x` if it's unique across the rows in the mark, else `*`. It is an aggregate — use it to put a dimension on a measure shelf / tooltip when you expect one value per mark.
- **Set membership** — testing whether a field is in a set uses the set as a boolean dimension (`[Set Name]` is true/false), not an `IN(...)` operator. For a literal value list use an `OR` chain or a `CASE`/`IF`.

## String

1-based indexing throughout (`MID(s, 5, 2)` starts at the 5th character). **`FIND(s, sub)` returns 0 when the substring is absent** (not -1) — test `FIND(...) > 0`, not `>= 0`. `SPLIT(s, delim, n)` is 1-based on `n`. `STR(x)` is the string cast (there is no `TOTEXT`). `CONTAINS`, `STARTSWITH`, `ENDSWITH`, `LEFT/RIGHT/MID`, `LEN`, `REPLACE`, `TRIM/LTRIM/RTRIM`, `UPPER/LOWER` behave conventionally.

## Math

`ABS`, `ROUND`, `CEILING`, `FLOOR`, `POWER`, `SQRT`, `LN`, `LOG`, `EXP`, `MOD`, `SIGN`, `PI`, plus casts `INT` (truncates toward zero) and `FLOAT`. **`LOG(x)` is base-10**; use `LN(x)` for natural log or `LOG(x, base)` for another base.

## Date

- **`DATEPART('unit', d)`** returns a **number** (e.g. month → 1–12); **`DATENAME('unit', d)`** returns a **string label** (e.g. month → "January"). Mixing them up is a common cause of unexpected axis labels or sort order.
- **`DATEPARSE('format', string)`** parses text to a datetime — but **returns NULL silently on live SQL connections** (it relies on the extract engine). On a live connection use `CAST`/custom SQL instead, or take an extract.
- `DATETRUNC`, `DATEADD`, `DATEDIFF` take a quoted unit (`'month'`) — unquoted fails. `MAKEDATE`, `DATE`, `DATETIME`, `TODAY()`, `NOW()`, and the named extractors `YEAR/MONTH/DAY/HOUR/MINUTE/SECOND/WEEK/QUARTER` behave conventionally. For the date-*part*-vs-*truncation* cross-year-rollup trap and integer date keys, see `expertise://tableau/tactics/data/tableau-date-handling`.

## Aggregates

- **`COUNT(x)` counts non-NULL values** of `x` (not rows); **`COUNTD(x)`** counts distinct non-NULL values (expensive on high-cardinality — see the LOD cookbook).
- **`STDEV`/`VAR`** are **sample** statistics; **`STDEVP`/`VARP`** are **population**. Choosing the wrong one shifts the result — pick deliberately based on whether the data is a sample or the whole population.
- `SUM`, `AVG`, `MIN`, `MAX`, `MEDIAN`, `PERCENTILE(x, p)` (p in 0–1) behave conventionally. `PERCENTILE` inside an LOD often replaces an `NTILE` table calc — see the cookbook.

## Statistical / regex

`CORR(x, y)`, `COVAR/COVARP`, and the `REGEXP_EXTRACT/REPLACE/MATCH` family exist. Regex availability depends on the data source (pushed down to the warehouse); a function valid in one connection may be unsupported in another — verify against the actual source.

## LOD & window / table calcs

LOD expressions (`{FIXED/INCLUDE/EXCLUDE …}`) and window/table calcs (`RUNNING_*`, `WINDOW_*`, `RANK*`, `INDEX`, `LOOKUP`, `TOTAL`, `FIRST/LAST`, `SIZE`, `PREVIOUS_VALUE`) have behavior that depends on filters, the order of operations, and addressing/sort. They are NOT cataloged here — see `expertise://tableau/tactics/data/lod-and-table-calc-patterns` for the recipes, the well-behaved-vs-fragile function families, sort-dependence, and the RANK-defaults-to-descending fact.

## Row-level-security identity

`USERNAME()`, `FULLNAME()`, `USERDOMAIN()`, `ISMEMBEROF('group')`, `ISUSERNAME('user')`, `USERATTRIBUTE('attr')` resolve against the *signed-in Tableau Server/Cloud user* at view time. They are the building blocks of user filters / row-level security; they return placeholder/empty values in Desktop when not signed in, so RLS logic can't be fully validated locally. Governed RLS belongs in the data source / a published user filter, not hidden in a workbook calc.

## Best Practices

- **Match the statistic to the data**: `STDEVP`/`VARP` for a full population, `STDEV`/`VAR` for a sample.
- **Use `COUNTD` only when you mean distinct** — it is materially more expensive than `COUNT`; on a primary key, `COUNT` (or `SUM([Number of Records])`) is cheaper.
- **Prefer `ZN()` for "missing = 0"** and `ISNULL()` for explicit null tests; don't conflate NULL with empty string.
- **Verify `DATEPARSE` on the actual connection type** before relying on it; it silently nulls on live SQL.
- **Treat RLS identity functions as governance**, not a convenience filter — they only resolve when signed in.

## Common Mistakes

1. **`DATEPART` where `DATENAME` was meant** (or vice versa) — number vs label; surfaces as wrong sort or wrong axis text.
2. **Assuming `COUNT` counts rows** — it counts non-NULL values of its argument; a nullable column undercounts.
3. **`STDEV` vs `STDEVP` chosen by habit** — sample vs population is a real semantic difference, not a synonym.
4. **`FIND(...) >= 0` to test "contains"** — `FIND` returns 0 when absent, so `>= 0` is always true; use `FIND(...) > 0` or `CONTAINS`.
5. **`DATEPARSE` on a live connection** — silently returns NULL; the calc looks valid but the column is empty.
6. **Building RLS logic with `USERNAME()` and testing only in Desktop** — it doesn't resolve to a real identity until signed in to Server/Cloud.

## Implementation

1. Pick the function family for the need; check this page for the gotcha before authoring.
2. For NULL-bearing inputs in conditional chains, apply the guards in the null-semantics companion.
3. For LOD/window/table calcs, follow the cookbook (addressing/sort are load-bearing).
4. Author the calc field per `expertise://tableau/tactics/data/calc-fields` (internal-name formulas, `[Calculation_<digits>]` naming), then verify in Tableau — especially `DATEPARSE` (connection type) and RLS functions (signed-in state).

## Source and Confidence

- Source/evidence type: SME-authored reference
- Source: Tableau function catalog with observed foot-guns and index/null-handling gotchas
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-03
