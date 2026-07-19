# Workbook XML: Calculated Fields, Parameters, and Tooltips

Confirmed patterns for calculated fields, parameters, parameter controls, count of records, Percent-of-Total table calcs, and tooltips — all validated via `tableau-get-workbook`.

**⇒ Wrong-fork check (live Desktop):** CREATING a calculated field on a running Tableau Desktop via the External API? Do NOT hand-edit workbook XML with these patterns — use the whole-document round-trip in [NotionalSpec Calc Authoring](notional-spec-calc-authoring.md) (save/load-underlying-metadata → GET/POST /v0/workbook/document), then chart the calc by caption with a spec. This module's XML patterns are for file-mode workbook authoring and for READING what a calc looks like.

**⇒ Wrong-fork check:** assigning GROUP MEMBERSHIP (tag rows Top/Bottom/Everyone-Else to color or drive a click action)? Don't hand-roll `IF RANK(...) <= [param] THEN "Top"...` — swapping RANK for `INDEX()`/`FIRST()`/`LAST()` is the SAME wrong turn. That's a **SET**, not a calc (sets ARE parameter-driven in XML — `count='[Parameters].[N]'` re-ranks live). See [Membership vs. Value](data/knowledge/strategy/analytics/calc-fields-strategy.md#membership-vs-value).

---

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, calculate
- In-scope reason: Defines the column XML for calculated fields, parameters, table calcs, and tooltips so Claude can author them.
- Out-of-scope risk: none
- Tags: calculated-fields, parameters, lod-expressions, table-calculations, tooltips
- Relevant user prompts/search terms: "how do I add a calculated field", "calculated field invalid data pane", "formula references caption not working", "top N per month partition", "quintile without table calc", "percent of total countdistinct base"

## Calculated fields

Calculated fields are `column` nodes on the **data datasource** with a `calculation` child:

```xml
<column name="[Calculation_1350661989330946]"
        role="dimension"
        caption="Is Selected Genre?"
        type="nominal"
        datatype="boolean">
  <calculation formula="[Parameters].[Parameter 1350661988413441] = [Top Level Genre]"
               class="tableau" />
</column>
```

**Critical rules:**
- `name` must use auto-generated format `[Calculation_<digits>]` — literal `Calculation`, **one** underscore, then a single contiguous run of digits, and nothing else. The digits are an opaque unique ID; any unique integer works as long as it's one unbroken run (a timestamp written as contiguous digits `[Calculation_20260407120000]`, a random, or a sequential id are all valid). Custom names like `[Is Selected Genre]` are invalid and will fail outright. **The failure mode is a SECOND underscore, not the use of a timestamp**: `[Calculation_20260407_001]` (any `[Calculation_<digits>_<suffix>]`) — the XML parser accepts it and the field shows in `tableau-list-available-fields`, but Tableau's formula-validation UI layer treats the name as malformed and flags the field "invalid" in the Data pane even when the formula compiled fine. So: one underscore + one digit run = valid (timestamps fine); any second underscore = invalid.
- Use `[Parameters].[Parameter <id>]` to reference a parameter in a formula — **NOT** the caption name.
- **Formulas reference fields by their internal `<column>` `name` attribute, never by caption.** Authoring a formula as `SUM([Sales])` against a datasource whose Sales column has `name='[M_Q1_SLS]' caption='Sales'` will fail: `[Sales]` is not a real internal name there. The UI's formula editor *displays* internal `[Calculation_<digits>]` names as their captions for readability, but the stored XML and the query-time resolution both operate on internal names. Author formulas with internal names directly: `SUM([M_Q1_SLS])`.
  - **Why this gets confused**: in Tableau Public's Superstore-style datasets, physical columns have `name='[Sales]' caption='Sales'` — name and caption are literally the same string. Formulas that look like `SUM([Sales])` there aren't resolving a caption; they're referencing the internal name which coincidentally equals it. This apparent "captions work" pattern is a coincidence of Superstore's schema, not a rule.
  - **Calc-to-calc references**: use the other calc's `[Calculation_<digits>]` internal name. Tableau Public's own workbooks use this form: `SUM({COUNTD([Calculation_607915613117825032])})`.
- Dependent calc fields: if the formula references other fields (e.g. `[Ship Mode]`, `[Order Date]`), those fields must also have column defs in `datasource-dependencies`, even if they're not on rows/cols/encodings

---

## LOD-legal aggregates: don't default to table calcs

Before reaching for a table calc, check whether the aggregate you want is LOD-legal. Over the Tableau release history the set of aggregates usable inside `{ FIXED/INCLUDE/EXCLUDE … : AGG(expr) }` has grown well beyond the classic `SUM / AVG / MIN / MAX / COUNT / COUNTD`. Using an LOD keeps the calc row-level-evaluable and removes the "must have the partitioning dimension on Detail" constraint that a table calc imposes.

**Confirmed LOD-legal aggregates (not exhaustive — verify against the target Tableau version):**
`SUM`, `AVG`, `MIN`, `MAX`, `COUNT`, `COUNTD`, `ATTR`, `VAR`, `VARP`, `STDEV`, `STDEVP`, `MEDIAN`, **`PERCENTILE` (since 2020.2)**, `CORR`, `COVAR`, `COVARP`.

### `PERCENTILE` inside LODs replaces `NTILE(k)` table calcs

SQL `NTILE(5) OVER (ORDER BY x DESC)` has no direct function equivalent in Tableau, and the common table-calc workaround (`CEILING(5.0 * INDEX() / SIZE())`) only resolves correctly when the partitioning dimension (e.g. `[Customer ID]`) is explicitly on the Detail shelf. The nested-LOD-PERCENTILE pattern avoids that entirely — the calc becomes a row-level attribute that works anywhere.

**Top-down quintile (higher metric = higher quintile), e.g. Monetary (R)FM:**
```
IF [Monetary (Sales)] >= { FIXED : PERCENTILE({ FIXED [Customer ID] : SUM([Sales]) }, 0.8) } THEN 5
ELSEIF [Monetary (Sales)] >= { FIXED : PERCENTILE({ FIXED [Customer ID] : SUM([Sales]) }, 0.6) } THEN 4
ELSEIF [Monetary (Sales)] >= { FIXED : PERCENTILE({ FIXED [Customer ID] : SUM([Sales]) }, 0.4) } THEN 3
ELSEIF [Monetary (Sales)] >= { FIXED : PERCENTILE({ FIXED [Customer ID] : SUM([Sales]) }, 0.2) } THEN 2
ELSE 1 END
```

**Bottom-up quintile (lower metric = higher quintile), e.g. Recency:**
```
IF [Recency (Days)] <= { FIXED : PERCENTILE({ FIXED [Customer ID] : DATEDIFF('day', MAX([Order Date]), TODAY()) }, 0.2) } THEN 5
ELSEIF [Recency (Days)] <= { FIXED : PERCENTILE(..., 0.4) } THEN 4
...
ELSE 1 END
```

**Why the nested FIXED matters:** the inner `{ FIXED [Customer ID] : … }` collapses each customer to a single row before the percentile is taken. Without it — e.g. `{ FIXED : PERCENTILE([Sales], 0.8) }` — customers with many transactions get over-weighted in the distribution, and the cutoffs shift toward heavy buyers. You almost always want the distribution at the *entity* grain, not the transaction grain.

**Semantic gotcha vs SQL `NTILE`:** `NTILE(k)` splits ties deterministically by row position to force exactly 1/k of rows into each bucket. PERCENTILE-cutoff comparisons put tied values in the same bucket, so bucket sizes can drift slightly when many entities share a value (common in frequency or rating distributions). For RFM / segmentation this is usually the better behavior — identical entities get identical treatment — but if you need exact parity with an upstream `NTILE` reference, that parity isn't achievable via PERCENTILE alone; fall back to the `INDEX()/SIZE()` table-calc pattern with the partition dimension on Detail.

**Heuristic:** if you're tempted to suggest a table calc because "Tableau doesn't have function X in LOD," first verify against the current LOD-legal list above. `PERCENTILE` was the specific miss that motivated this note — quintile / decile / Nth-percentile-cutoff logic is frequently reached-for, and the row-level LOD form is strictly better than the table-calc form when it's available.

---

## Round-trip normalization

Tableau rewrites calc-field XML on save (caption→internal-name, re-sort, re-quote). Author formulas with **internal names** (`SUM([M_Q1_SLS])`) not captions to avoid transient Data-pane "invalid" flags. Full reference: `expertise://tableau/tactics/data/round-trip-normalization`.

## Inline calculated fields in `datasource-dependencies`

Calculated fields can be defined **per-worksheet** inside `datasource-dependencies` without modifying the main datasource node. These are scoped to the worksheet and use simplified names (no `Calculation_<id>` required at this level).

```xml
<column name="[Calc_ContentType]"
        caption="Content Type"
        role="dimension"
        type="nominal"
        datatype="string">
  <calculation formula="IF ISNULL([master_metadata_track_name]) THEN 'Podcast' ELSE 'Music' END"
               class="tableau" />
</column>
```

Matching column-instance (prefix `usr:`, derivation `User` for calcs; or `none:` / `derivation="None"` for nominal calcs):
```xml
<column-instance name="[none:Calc_ContentType:nk]"
                 column="[Calc_ContentType]"
                 derivation="None"
                 pivot="key"
                 type="nominal" />
```

Works for: `IF/ELSEIF/ELSE`, `CONTAINS()`, `ISNULL()`, string manipulation, and arithmetic on existing fields. The formula references raw field names `[field_name]` (not column-instance names).

**CONTAINS-based grouping pattern** (e.g. platform normalization):
```
IF CONTAINS(LOWER([platform]), "android") THEN "Mobile"
ELSEIF CONTAINS(LOWER([platform]), "ios") THEN "Mobile"
ELSEIF CONTAINS(LOWER([platform]), "windows") THEN "Desktop"
ELSE "Other"
END
```

---

## Parameters

Parameters live in the dedicated **`Parameters` datasource** (separate from the data datasource):

```xml
<datasource name="Parameters" version="18.1" inline="true" hasconnection="false">
  <aliases enabled="yes" />
  <column role="measure"
          caption="Top Level Genre Parameter"
          value="&quot;Alternative&quot;"
          type="nominal"
          name="[Parameter 1350661988413441]"
          datatype="string"
          param-domain-type="list">
    <calculation formula="&quot;Alternative&quot;" class="tableau" />
    <members>
      <member value="&quot;Alternative&quot;" />
      <member value="&quot;Pop&quot;" />
    </members>
  </column>
</datasource>
```

**Key rules:**
- `name` format: `[Parameter <large-integer>]` — use a unique large integer
- `value` and `calculation formula` both hold the default value (XML-escaped double-quoted string for string params: `&quot;Alternative&quot;`)
- `param-domain-type`: `"list"` for enumerated values, `"range"` for numeric range, `"any"` for free entry
- `members` children list allowed values — string values are double-quoted (XML-escaped)
- `role` is always `"measure"` regardless of data type
- **NEVER modify the Parameters datasource unless explicitly asked** — it is a Critical Rule in SKILL.md

---

## Parameter control on a worksheet

To show a parameter control on a worksheet, add a **`right` edge** to the window's `cards` node:

```xml
<cards>
  <edge name="right">
    <strip size="160">
      <card mode="compact" type="parameter" param="[Parameters].[Parameter 1350661988413441]" />
    </strip>
  </edge>
</cards>
```

- Goes on the **`right` edge** of the window's cards — not `left`
- Card type is `"parameter"` (singular)
- `mode="compact"` shows the compact control
- `param` = `[Parameters].[Parameter <id>]`

---

## Count of records / table count field

The built-in count field uses an internal object ID pattern:

```xml
<!-- Column def -->
<column name="[__tableau_internal_object_id__].[Orders_ECFCA1FB690A41FE803BC071773BA862]"
        caption="Orders"
        role="measure"
        type="quantitative"
        datatype="table" />

<!-- Column-instance -->
<column-instance name="[__tableau_internal_object_id__].[cnt:Orders_ECFCA1FB690A41FE803BC071773BA862:qk]"
                 column="[__tableau_internal_object_id__].[Orders_ECFCA1FB690A41FE803BC071773BA862]"
                 pivot="key"
                 type="quantitative"
                 derivation="Count" />
```

In `cols`/`rows` content (includes datasource prefix):
```
[Sample - Superstore].[__tableau_internal_object_id__].[cnt:Orders_ECFCA1FB690A41FE803BC071773BA862:qk]
```

The internal ID suffix is workbook-specific — inspect your datasource to find the correct value with `tableau-get-workbook`.

---

## Percent of Total table calculation

Add a second column-instance for the same field with:
- Name prefix changed: `cnt:` → `pcto:cnt:` (pattern: `pcto:{original-ci-name}`)
- A `table-calc` child node

```xml
<column-instance name="[__tableau_internal_object_id__].[pcto:cnt:Orders_ECFCA1FB690A41FE803BC071773BA862:qk]"
                 column="[__tableau_internal_object_id__].[Orders_ECFCA1FB690A41FE803BC071773BA862]"
                 pivot="key"
                 type="quantitative"
                 derivation="Count">
  <table-calc type="PctTotal" ordering-type="Rows" />
</column-instance>
```

Reference in a `text` encoding:
```xml
<text column="[DS].[__tableau_internal_object_id__].[pcto:cnt:Field:qk]" />
```

---

## Customized tooltips

Tooltips are defined via a `customized-tooltip` node — **direct child of `pane`** (sibling to `mark`, `encodings`, etc.):

```xml
<customized-tooltip show-buttons="false">
  <formatted-text>
    <run fontsize="20" fontalignment="1" bold="true" fontcolor="#4e79a7">&lt;[DS].[none:Artist Name(s):nk]&gt;</run>
    <run fontalignment="1">&#198;
</run>
    <run fontalignment="1" fontcolor="#757575">Avg. Danceability: </run>
    <run fontalignment="1" bold="true">&lt;[DS].[avg:Danceability:qk]&gt;</run>
  </formatted-text>
</customized-tooltip>
```

**`run` attrs:**
| `attr` | Notes |
|---|---|
| `fontsize` | Point size as string, e.g. `"20"`, `"12"` |
| `fontalignment` | `"1"` = center; `"0"` = left; `"2"` = right |
| `bold` | `"true"` |
| `italic` | `"true"` |
| `fontcolor` | Hex string e.g. `"#4e79a7"` |
| content | Static text OR field value in angle brackets: `<[DS].[column-instance]>` (XML-escaped as `&lt;...&gt;`) |

**Line breaks:** Use a `run` with a literal newline in its text content.

**Field references:** Wrap in angle brackets (XML-escaped): `&lt;[DS].[none:Field:nk]&gt;`.

`show-buttons="false"` hides the command buttons (View Data, etc.); omit or set `"true"` to show them.

---

## Tableau Order of Operations

Know this when debugging why filters and calculations interact unexpectedly:

1. Extract Filters → 2. Data Source Filters → 3. **Context Filters** →
4. Sets / Conditional Filters / Top N / **FIXED LOD** →
5. Dimension Filters → 6. INCLUDE/EXCLUDE LOD →
7. Measure Filters → 8. **Table Calculations** →
9. **Table Calc Filters** → 10. Trend/Reference Lines

Key implications:
- **Context filters** (step 3) restrict data before FIXED LODs (step 4) — use to scope LOD calculations
- **Table calc filters** (step 9) run after all aggregation — ideal for Top N via `INDEX() <= N`
- Prefer **table calcs + context filters** over FIXED LODs for flexible analysis — FIXED LODs query the entire dataset regardless of regular filters

---

## RANK bump chart (rank on rows, time on cols)

A bump chart shows ranking changes over time. RANK goes on discrete rows, a time dimension on cols, and a dimension (e.g. Sub-Category) on Path/Color to draw connecting lines.

### Column definition (RANK calc with default table-calc)

```xml
<column caption="Sales Rank" datatype="integer" name="[Calculation_Rank]"
        role="measure" type="quantitative">
  <calculation class="tableau" formula="RANK(SUM([Sales]))">
    <table-calc ordering-type="Rows"/>
  </calculation>
</column>
```

### Column-instance (discrete ordinal, compute using specific field)

```xml
<column-instance column="[Calculation_Rank]" derivation="User"
                 name="[usr:Calculation_Rank:ok:1]" pivot="key" type="ordinal">
  <table-calc ordering-type="Field"
              ordering-field="[federated.superstore001].[none:Sub-Category:nk]"/>
</column-instance>
```

**Key points:**
- The CI uses `type="ordinal"` (discrete) so rank positions are evenly spaced on the axis
- `derivation="User"` and `usr:` prefix — required for all aggregate/table-calc fields
- `ordering-field` in the CI's `table-calc` overrides the column-level `ordering-type="Rows"` — this sets "Compute Using: Sub-Category"
- The `:ok:1` suffix — the `:1` part is assigned by Tableau; don't guess it. Use `tableau-get-worksheet` after initial apply to discover the exact suffix

### Shelf config

```xml
<rows>[DS].[usr:Calculation_Rank:ok:1]</rows>
<cols>[DS].[yr:Order Date:ok]</cols>
```

With `mark class="Line"` and Sub-Category on Color/Detail, this renders a bump chart.

---

## WINDOW_* KPI sparkline table pattern

A common pattern: rows of KPI metrics per dimension, with sparklines showing the trend over time.

### Shelf structure

```
Rows: (Team / (KPI1 / KPI2 / ... / KPI_N)) * (sparkline_measure + end_mark_calc)
Cols: continuous_date (e.g., [tdy:Timestamp:qk])
```

- `/` nests dimensions — Team is outer, KPIs are inner (each renders as a text header)
- `*` creates a separate pane for the sparkline alongside the KPI text
- `+` stacks measures on the same axis (dual-axis sparkline + end mark)

### KPI calc formulas (all use `<table-calc ordering-type="Rows"/>`)

```
Total:           WINDOW_SUM(COUNT([records]))
Highest:         WINDOW_MAX(COUNT([records]))
Lowest:          WINDOW_MIN(COUNT([records]))
Average:         WINDOW_AVG(COUNT([records]))
Most Recent:     IF ATTR([Date]) = WINDOW_MAX(MAX([Date])) THEN COUNT([records]) END
Previous Period: WINDOW_MAX(IF INDEX()=SIZE()-1 THEN COUNT([records]) END)
Variance:        [Most Recent] - [Previous Period]
```

### Critical XML patterns

1. **KPI column-instances use `:ok` (ordinal) type** — renders as discrete text headers, not continuous axes:
   ```xml
   <column-instance column="[Calc_Total]" derivation="User" name="[usr:Calc_Total:ok]" pivot="key" type="ordinal">
     <table-calc ordering-type="Rows"/>
   </column-instance>
   ```

2. **Sparkline column-instances use `:qk` (quantitative) type** — renders as continuous axis:
   ```xml
   <column-instance column="[Records]" derivation="Count" name="[cnt:Records:qk]" pivot="key" type="quantitative"/>
   ```

3. **Chained table calcs need nested `<table-calc field="...">` references:**
   ```xml
   <column-instance column="[Calc_Variance]" derivation="User" name="[usr:Calc_Variance:ok]" pivot="key" type="ordinal">
     <table-calc ordering-type="Rows"/>
     <table-calc field="[datasource].[Calc_MostRecent]" ordering-type="Rows"/>
     <table-calc field="[datasource].[Calc_PrevPeriod]" ordering-type="Rows"/>
   </column-instance>
   ```

4. **Multiple panes with different mark types:**
   - Default pane: `mark="Automatic"` — KPI text
   - Pane 2: `mark="Circle"` — end mark dot (y-axis = end mark calc)
   - Pane 3: `mark="Automatic"` (line) — sparkline (y-axis = COUNT)
   
   Each pane gets `minheight`/`maxheight` for consistent row sizing.

5. **Axis hiding for sparkline panes:**
   ```xml
   <style-rule element="axis">
     <format attr="display" class="0" field="[datasource].[usr:EndMark:qk]" scope="rows" value="false"/>
   </style-rule>
   ```

---

## Data densification with INDEX() (null-aware aggregation)

When building crosstabs or heatmaps that must show **all dimension combinations** — including those with no data — standard Tableau filters remove the empty rows entirely. This breaks averages because the denominator excludes items with no activity.

### The INDEX() trick

Place an `INDEX()` table calculation on the **Detail shelf**. This forces Tableau to generate a mark for every cell in the dimension cross-product, even where the underlying measure is null. Combined with `ZN()` (Zero if Null), this converts missing values to 0 and makes averages include all dimension members.

### Pattern

1. **Create an INDEX() calc field:**
```xml
<column caption="Index" datatype="integer" name="[Calculation_Index]"
        role="measure" type="quantitative">
  <calculation class="tableau" formula="INDEX()">
    <table-calc ordering-type="Rows"/>
  </calculation>
</column>
```

2. **Create a null-safe measure:**
```
ZN(COUNTD(IF [Order Date] >= [pMinDate] AND [Order Date] <= [pMaxDate]
          THEN [Order ID] END))
```
The `ZN()` wrapper converts nulls (from densified empty cells) to 0.

3. **Place INDEX() on Detail shelf** and the null-safe measure on Text/Color.

4. **Use parameter-based filtering** (not standard quick filters) to control the date range. Standard filters remove dimension values from the viz; parameters with an IF condition in the measure preserve all dimension members.

### Why this works

- `INDEX()` on Detail creates a mark for every intersection of the dimensions on Rows × Columns
- Tableau's mark generation fills in the gaps that would otherwise be absent
- `ZN()` turns the resulting nulls into 0
- Subtotals then compute correct averages across ALL members, not just those with data

### Key distinction: filter types and their effect on densification

| Filter type | Effect on dimensions | Effect on FIXED LODs |
|---|---|---|
| **Standard dimension filter** | Removes filtered-out values from viz | Ignored by FIXED |
| **Context filter** | Removes filtered-out values from viz | Respected by FIXED |
| **Parameter + IF in calc** | All values remain visible; measure returns null/0 for excluded rows | No effect (no filter applied) |

**For null-aware averages, use parameter-based filtering** — it preserves all dimension members in the viz while controlling what data is counted.

---

## Per-partition Top N (Rank on Rows pattern)

When showing Top N items **per partition** (e.g., top 10 sub-categories per month), do NOT put the dimension on Rows — that creates a union of all partitions' items. Instead: **put rank on Rows, dimension on Label**.

**Step 1:** Add an `INDEX()` calculated field. Tableau stores a `table-calc` node **inside the `calculation` child** (not just in the CI):
```xml
<column name="[Calculation_Rank]" caption="Rank"
        role="measure" type="ordinal" datatype="integer">
  <calculation formula="INDEX()" class="tableau">
    <table-calc ordering-type="Rows" />
  </calculation>
</column>
```

**Step 2:** Add **two column-instances** in `datasource-dependencies` — one discrete (Rows), one continuous (Filter). Use `ordering-field=""` (not `level-address`) in the CI's `table-calc`:
```xml
<!-- Discrete (ordinal) — goes on Rows shelf -->
<column-instance name="[usr:Calculation_Rank:ok:1]" column="[Calculation_Rank]"
                 pivot="key" type="ordinal" derivation="User">
  <table-calc ordering-type="Field" ordering-field="" />
</column-instance>

<!-- Continuous (quantitative) — goes on Filter shelf -->
<column-instance name="[usr:Calculation_Rank:qk]" column="[Calculation_Rank]"
                 pivot="key" type="quantitative" derivation="User">
  <table-calc ordering-type="Field" ordering-field="" />
</column-instance>
```

**Step 3:** Configure the worksheet:
- **Rows:** `[DS].[usr:Calculation_Rank:ok:1]` (discrete — creates rank partitions 1, 2, 3…)
- **Cols:** `([DS].[tmn:Order Date:ok] * [DS].[sum:Sales:qk])` (month × measure)
- **Label encoding:** `[DS].[none:Sub-Category:nk]` (the dimension on Label, NOT on Rows)
- **Filter:** quantitative range on the continuous rank CI:

```xml
<filter column="[DatasourceName].[usr:Calculation_Rank:qk]"
        class="quantitative"
        included-values="in-range">
  <max>10</max>
</filter>
```

**`slices` required for table calc filter CI:** Add a `slices` node in `view` referencing the continuous CI — same as for categorical dimension filters. Without it, the filter CI may be stripped:
```xml
<slices>
  <column>[DS].[usr:Calculation_Rank:qk]</column>
</slices>
```

**Why quantitative filter on continuous CI:** A quantitative filter on an ordinal CI is invalid. The discrete CI (`:ok:`) is for shelf placement; the continuous CI (`:qk`) is for range comparisons. The filter CI may have no numeric suffix.

**Table calc config note:** The `:N` suffix on column-instance names varies (`:1`, `:2`, `:4` or none) — don't assume `:2`. Always check real workbook output. `ordering-type` values: `None` | `Rows` | `Columns` | `Table` | `Pane` | `Field`.

---

## Translating SQL to Tableau Calculations

When refactoring a custom SQL datasource to native tables, SQL-computed columns become Tableau calculated fields. The full translation reference (FIXED LOD vs. table calc choice, scalar/window function maps, NTILE alternatives, nested LOD patterns, XML formula escaping) lives in its own module: see `expertise://tableau/tactics/data/sql-translation`. The datasource-refactor workflow itself (`object-graph` + `relationships`) is in `expertise://tableau/tactics/data/datasources`.

**Default translation rules:** `GROUP BY` → FIXED LOD; `OVER (...)` → table calc with explicit Compute Using; scalar expression → scalar function; `CASE` → `IF/ELSEIF/ELSE`. For exact `NTILE(k)` semantics (equal-count buckets) prefer the LOD `PERCENTILE` cutoff pattern documented in this file's "LOD-legal aggregates" section.

---

## When to Use

Use this module when you need to:
- **Add a calculated field** to an existing datasource (e.g. profit ratio, date difference, string categorization)
- **Translate SQL expressions** to Tableau calculated fields during datasource refactoring
- **Set up a parameter** with a list or range of allowed values that a calculated field references
- **Configure a table calculation** (running total, rank, percent of total, moving average) with specific Compute Using settings
- **Apply a Top N filter per partition** (rank on rows + quantitative filter pattern)
- **Debug unexpected filter/calc interactions** — refer to the Tableau Order of Operations section

If you only need to place a field on shelves without any calculation logic, see `expertise://tableau/tactics/viz/worksheets` instead.

---

## Best Practices

- **Use timestamped calc names**: `[Calculation_20260303120000_001]` prevents collisions across sessions. Never use plain names like `[My Calc]` or `[R Score]` — Tableau silently rejects them and shows a red error in the data pane even when the formula is valid.
- **Datasource-level vs inline calc naming**: Datasource-level calc columns (direct children of `<datasource>`) should always use `[Calculation_<id>]` format. Inline calc columns inside `<datasource-dependencies>` can use shorter names like `[Calc_ContentType]`, but `[Calculation_*]` is always safe at both levels.
- **Reference fields by raw name in formulas**: Use `[Sales]` not `[sum:Sales:qk]` inside `calculation.formula`. CI-format references are not valid formula syntax.
- **Always declare calc field column-instances in datasource-dependencies**: Even if the calc is defined at the datasource level, the worksheet's `datasource-dependencies` must still list the column def and column-instance for any worksheet that uses it.
- **Parameters are in their own datasource**: Never add parameter columns to the data datasource. Use the dedicated `Parameters` datasource (name = `"Parameters"`).
- **Parameters must be referenced by a worksheet to survive round-trip**: The Agent API strips the Parameters datasource if no worksheet references it. To create a parameter programmatically: (1) Add the parameter `<column>` inside a `<datasource-dependencies datasource='Parameters'>` block in at least one worksheet's `<view>`, and (2) also add `<datasource name='Parameters' />` to that worksheet's `<datasources>` block.
- **Calc fields with aggregations (COUNTD, SUM, etc.) must use `usr:` prefix**: The column-instance `name` must be `[usr:CalcName:qk]` with `derivation="User"`, NOT `[none:CalcName:qk]` with `derivation="None"`. Using `none:` on an aggregate calc causes the viz to render blank.
- **Use context filters with FIXED LODs**: FIXED LOD calculations ignore regular dimension filters. Wrap the controlling filter in `context: "true"` to scope the LOD calculation.
- **Table calc ordering-type matters**: `"Rows"` = Table (Down), `"Field"` + `ordering-field` = Compute Using a specific dimension. Always verify the `:N` suffix on the CI name by inspecting a working workbook.

---

## Common Mistakes

1. **Using the caption name in a formula**: `[Parameters].[Top Level Genre Parameter]` fails — use the internal name `[Parameters].[Parameter 1350661988413441]`.
2. **Missing column def in datasource-dependencies**: A calc field defined at the datasource level still requires a duplicate `column` node in the worksheet's `datasource-dependencies`. Omitting it causes the field to be stripped.
3. **Wrong `:N` suffix on table calc CI**: The suffix (`:1`, `:2`, `:4`) varies and cannot be guessed. Inspect a real workbook with `tableau-get-workbook` after manually configuring the table calc in Tableau's UI.
4. **Applying percent of total to the wrong base**: `pcto:sum:` for SUM base, `pcto:ctd:` for CountDistinct base, `pcto:cnt:` for Count base. Using the wrong prefix produces an empty column-instance.
5. **Putting table-calc config in the column def**: The `table-calc` node goes inside the **column-instance** in `datasource-dependencies`, not inside the `calculation` child of the column def.
6. **Forgetting `slices` for table calc filters**: When a table calc column-instance is used as a filter (quantitative range), a `slices` node must reference its CI — otherwise the filter is stripped on round-trip.
7. **Using NTILE range-mapping for exact bucket counts**: Range-mapping creates equal-width buckets, not equal-count. For exact quintiles matching SQL NTILE, use RANK-based bucketing.
8. **"Valid formula" but red error state in data pane**: This can happen when the datasource-level `column` `name` attribute uses a custom string (e.g., `[R Score]`) instead of the expected `[Calculation_<id>]` format. Tableau's formula editor validates the expression independently of the internal name, so it may report "The calculation is valid" while the field still shows a red exclamation. Fix: rename `name` to `[Calculation_<timestamp>_<seq>]` format and move the human-readable name to `caption`. Note: this is the **leading hypothesis** based on observed correlation — the symptom may also be caused by formula errors, missing datasource dependencies, stale caches, or other factors coincident with the non-standard name. Causation is not confirmed. The preflight validation in the MCP server logs a warning when it detects this pattern and captures artifacts for analysis; it does not block the apply.

---

## Implementation

The general workflow for adding a calculated field and using it on a worksheet:

1. **Add column def to datasource** — at the datasource level in `datasources`, add a `column` node with a `calculation` child.
2. **Add column def + column-instance to datasource-dependencies** — every worksheet that uses the field needs both nodes in its `datasource-dependencies`.
3. **Reference the CI on shelves/encodings** — use the full `[DS].[ci:field:type]` format in `rows`, `cols`, or encoding `column` attrs.
4. **For table calcs**: Add a `table-calc` child to the column-instance in `datasource-dependencies`. Configure `ordering-type` and `ordering-field` or `level-address` as needed.
5. **Submit and verify**: Use `tableau-apply-workbook`, then `tableau-list-worksheets` to confirm the sheet loaded. Use `tableau-get-workbook` to inspect the round-tripped result and check whether all nodes survived.

---

## PctTotal on CountDistinct base (`pcto:ctd:`)

When applying Percent of Total to a **CountDistinct** measure, the column-instance prefix is `pcto:ctd:` (not `pcto:sum:`):

```xml
<column-instance name="[pcto:ctd:Track Name:qk]"
                 column="[Track Name]"
                 derivation="None"
                 pivot="key"
                 type="quantitative">
  <table-calc type="PctTotal" ordering-type="Field"
              ordering-field="[DS].[Album (group)]" />
</column-instance>
```

The pattern generalizes: `pcto:{base-agg}:` where `base-agg` matches the underlying aggregation type — `sum`, `ctd` (CountDistinct), `avg`, etc.


