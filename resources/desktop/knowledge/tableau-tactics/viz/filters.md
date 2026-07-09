# Workbook XML: Filters

Confirmed patterns for all worksheet filter types in Tableau workbook XML. All patterns validated via `tableau-get-workbook` observation after manual authoring.

---

## Filter placement in view

Filters live in `view` as siblings of `datasource-dependencies` and `aggregation`. A `slices` node listing all filtered column-instances is also required.

```
view
  datasources
  datasource-dependencies   ← include column defs + CIs for filtered fields
  computed-sort             ← sort nodes MUST come before filters (if any)
  filter                    ← one per filtered field
  filter
  slices                    ← lists all filtered column-instances
  aggregation
```

Column defs + column-instances for filtered fields must be in `datasource-dependencies` even if they are not on rows/cols/encodings.

**Critical:** If the view has a `computed-sort`, `shelf-sorts`, or `natural-sort` node, it must appear **before** any `filter` nodes. Placing sort nodes after `slices` causes workbook errors.

---

## Categorical filter (include specific values)

```xml
<filter column="[Sample - Superstore].[[Segment]]" class="categorical">
  <groupfilter user:ui-enumeration="exclusive"
               user:ui-marker="enumerate"
               function="union">
    <groupfilter function="member" level="[none:Segment:nk]" member="Consumer" />
    <groupfilter function="member" level="[none:Segment:nk]" member="Corporate" />
  </groupfilter>
</filter>
```

**Critical format notes:**
- `filter column` format: `[datasourceId].[[FieldName]]` (double-bracketed) — NOT column-instance format like `[DS].[none:Segment:nk]`
- `groupfilter level` attribute: use CI format `[none:Segment:nk]`, NOT raw field `[Segment]`
- Boolean field member values: `"True"` or `"False"` (capital T/F) — lowercase `"true"`/`"false"` silently fails

---

## Single-value categorical filter (e.g. Year = 2024)

```xml
<filter column="[Sample - Superstore].[yr:Order Date:ok]" class="categorical">
  <groupfilter user:ui-marker="enumerate"
               user:ui-domain="database"
               function="member"
               user:ui-enumeration="inclusive"
               member="2024"
               level="[yr:Order Date:ok]" />
</filter>
```

- `member` — the filter value as string (`"2024"`, `"4"` for quarter, `"Consumer"` for dimension)
- `level` — the column-instance name (without DS prefix)

---

## Date filter column-instance naming

| Tableau filter | Column-instance name | derivation | type |
|---|---|---|---|
| Year | `[yr:Order Date:ok]` | `Year` | `ordinal` |
| Quarter | `[qr:Order Date:ok]` | `Quarter` | `ordinal` |
| Month | `[mn:Order Date:ok]` | `Month` | `ordinal` |
| Week | `[wk:Order Date:ok]` | `Week` | `ordinal` |

---

## Continuous date range filter

```xml
<filter column="[Sample - Superstore].[none:Order Date:qk]"
        filter-group="4"
        class="quantitative"
        included-values="in-range">
  <min>#2023-01-03#</min>
  <max>#2026-12-30#</max>
</filter>
```

Column-instance for this filter: derivation `None`, type `quantitative`, suffix `qk`. Date strings use `#YYYY-MM-DD#` format.

---

## Cross-sheet filter (`filter-group`)

To make a filter on one worksheet also control other worksheets on the same dashboard, add the same filter to each target worksheet with the **same `filter-group` integer**. Tableau synchronizes filters sharing a `filter-group` across sheets.

Use `function="level-members"` with `user:ui-enumeration="all"` to create an "all members selected" interactive filter control:

```xml
<filter column="[Sample - Superstore].[none:Region:nk]"
        filter-group="3"
        class="categorical">
  <groupfilter user:ui-marker="enumerate"
               user:ui-enumeration="all"
               level="[none:Region:nk]"
               function="level-members" />
</filter>
```

Steps:
1. Add filter + `slices` + column def + CI to **every** worksheet that should respond
2. Use the **same `filter-group` integer** on all of them
3. Pick any integer not already in use in those worksheets
4. No changes needed to the dashboard node

---

## Slices node (required when any filters present)

A `slices` node must be present in `view`, listing every filtered column-instance:

```xml
<slices>
  <column>[Sample - Superstore].[yr:Order Date:ok]</column>
  <column>[Sample - Superstore].[none:Region:nk]</column>
</slices>
```

---

## Filtering Measure Names (controlling which measures appear in a crosstab)

To show only specific measures in a Measure Names/Values crosstab, add a categorical filter on `[:Measure Names]`:

```xml
<filter column="[Sample - Superstore].[:Measure Names]" class="categorical">
  <groupfilter user:ui-marker="enumerate"
               user:ui-enumeration="inclusive"
               user:ui-domain="relevant"
               function="union">
    <groupfilter function="member"
                 level="[:Measure Names]"
                 member="&quot;[Sample - Superstore].[sum:Sales:qk]&quot;" />
    <groupfilter function="member"
                 level="[:Measure Names]"
                 member="&quot;[Sample - Superstore].[sum:Profit:qk]&quot;" />
  </groupfilter>
</filter>
```

Key differences from standard categorical:
- `user:ui-domain` is `"relevant"` (not `"database"`)
- `member` values are **double-quoted fully-qualified column-instance refs** (XML-escaped: `&quot;...&quot;`)
- `level` is `"[:Measure Names]"` (no DS prefix)
- Also requires a `slices` node with `[DS].[:Measure Names]`

Also add a `slices` node:
```xml
<slices>
  <column>[Sample - Superstore].[:Measure Names]</column>
</slices>
```

---

## Top N filter (native `function="end"` groupfilter)

A Top N filter limits a dimension to its top N members by a measure. Uses nested groupfilters inside a categorical filter. Confirmed working via `tableau-apply-workbook`.

```xml
<filter class="categorical" column="[DS].[none:master_metadata_album_artist_name:nk]">
  <groupfilter function="end"
               end="top"
               count="50"
               user:ui-top-by-field="true"
               units="records"
               user:ui-marker="end">
    <groupfilter function="order"
                 direction="DESC"
                 expression="SUM([ms_played])"
                 user:ui-marker="order">
      <groupfilter function="level-members"
                   level="[none:master_metadata_album_artist_name:nk]"
                   user:ui-enumeration="all"
                   user:ui-marker="enumerate" />
    </groupfilter>
  </groupfilter>
</filter>
```

Also requires a `slices` node referencing the filtered CI.

Key attrs:
- `count` — N as a string
- `direction` — `"DESC"` (top) or `"ASC"` (bottom)
- `expression` — the aggregation expression, e.g. `"SUM([ms_played])"`, `"SUM([Sales])"`
- `level` — the column-instance name (without DS prefix)

> **Note:** Previous docs flagged `function="filter"` Top N as unreliable. The `function="end"` pattern above is the correct approach and does survive round-trips.

---

## When to Use

Use this module when you need to:
- **Filter a worksheet to specific dimension values** (e.g. Region = "East", Segment in {Consumer, Corporate})
- **Apply a date range filter** — either categorical (year/quarter/month) or continuous (date range)
- **Create a Top N filter** that limits a dimension to its top N members by a measure
- **Set up cross-sheet filters** that synchronize multiple worksheets on a dashboard
- **Filter on Measure Names** to control which measures appear in a multi-measure crosstab
- **Mark a filter as a context filter** so it runs before FIXED LOD calculations

For table calculation filters (filtering based on a table calc like INDEX() <= 10), see `workbook-calcs.md`.

---

## Best Practices

- **Use the correct `filter column` format**: The `column` attr on a `filter` node uses `[datasourceId].[[FieldName]]` (double-bracketed raw field name) — NOT column-instance format. Using CI format here silently fails.
- **Always add a `slices` node**: The `slices` node listing all filtered CIs must be present in `view` for filters to survive round-trip. Missing it causes categorical filters to be stripped.
- **Declare filter fields in datasource-dependencies**: Even fields that only appear in a filter (not on rows/cols/encodings) must have a `column` def and `column-instance` in `datasource-dependencies`.
- **Keep sort nodes before filter nodes**: In `view > children`, `computed-sort`, `shelf-sorts`, and `natural-sort` must appear **before** any `filter` nodes. Sort nodes after `slices` cause workbook errors.
- **Use `function="end"` for Top N** — not `function="filter"`. The `function="filter"` approach is unreliable and doesn't survive round-trips. The `function="end"` groupfilter pattern with a nested `function="order"` child is the correct approach.
- **Boolean member values must be capitalized**: `"True"` and `"False"` (capital T/F). Lowercase `"true"`/`"false"` silently fails.

---

## Common Mistakes

1. **Wrong filter column format**: Using `[DS].[none:Region:nk]` (CI format) instead of `[DS].[[Region]]` (double-bracketed raw field). The CI format is for `groupfilter level` attributes, not for the `filter column` attribute.
2. **Missing `slices` node**: Without the `slices` node listing the filtered CIs, categorical filters are stripped when Tableau round-trips the workbook.
3. **Sort nodes after filters**: Placing `shelf-sorts` or `computed-sort` after `filter` nodes in `view` children causes workbook load errors. Sort nodes must come before filter nodes.
4. **Using `function="filter"` for Top N**: This approach doesn't survive `loadMetadataFromXml`. Use `function="end"` with a nested `function="order"` child.
5. **Wrong `groupfilter level` format**: The `level` attribute on groupfilter uses CI format without the DS prefix: `[none:Segment:nk]` — not `[DS].[none:Segment:nk]` and not the raw field name `[Segment]`.
6. **Missing `filter-group` for cross-sheet sync**: Filters only synchronize across worksheets when they share the same `filter-group` integer. Without it, each worksheet's filter operates independently.

---

## Implementation in Tableau Desktop

To add a categorical filter to a worksheet:

1. **Get the datasource ID** from `get_workbook_summary` (e.g. `federated.0abc123`).
2. **Add the column def + CI to `datasource-dependencies`** for the filtered field (if not already present).
3. **Construct the filter node** using `[DS].[[FieldName]]` format for the `column` attr, and `[none:FieldName:nk]` for the `groupfilter level` attr.
4. **Add or update the `slices` node** in `view` to reference the CI: `[DS].[none:FieldName:nk]`.
5. **Ensure filter nodes appear after any sort nodes** in `view > children` ordering.
6. **Submit via `try_set_workbook`** and inspect with `get_workbook` to confirm the filter survived.

For cross-sheet filters: repeat steps 1–5 for every worksheet that should respond to the filter, using the same `filter-group` integer on all filter nodes.

For context filters: add `context: "true"` to the filter node `attrs`. Context filters must appear before any FIXED LOD expressions that need to be scoped by them.

---

## Context filter

Context filters run in step 3 of Tableau's Order of Operations (before dimension filters). Add `context="true"` to the filter node:

```xml
<filter column="[DS].[[Month]]" class="categorical" context="true">
  ...
</filter>
```

---

## When to Use

Use this module when you need to:

- Add a **categorical filter** (include/exclude specific dimension members)
- Add a **date filter** (year, quarter, month, or continuous date range)
- Create a **Top N filter** on a dimension ranked by a measure
- Build a **cross-sheet filter** that synchronizes across multiple worksheets on a dashboard
- Apply a **context filter** to scope FIXED LOD calculations or Top N filters
- Filter on **Measure Names** to control which measures appear in a crosstab
- Understand the required `slices` node structure and why filters get stripped

---

## Best Practices

- **Use `function="end"` for Top N** — not `function="filter"`. The `function="filter"` approach is unreliable and doesn't survive round-trips. The `function="end"` groupfilter pattern with a nested `function="order"` child is the correct approach.
- **Boolean member values must be capitalized**: `"True"` and `"False"` (capital T/F). Lowercase `"true"`/`"false"` silently fails.
- **Always add a `slices` node** when any filter is present. Without it, categorical filters are stripped on round-trip.
- **Sort nodes must come before filter nodes** in `view` children. Placing `shelf-sorts` or `computed-sort` after `filter` nodes causes workbook load errors.
- **Use the same `filter-group` integer** on all worksheets that should synchronize a cross-sheet filter.

---

## Common Mistakes

1. **Wrong filter column format**: Using `[DS].[none:Region:nk]` (CI format) instead of `[DS].[[Region]]` (double-bracketed raw field). The CI format is for `groupfilter level` attributes, not for the `filter column` attribute.
2. **Missing `slices` node**: Without the `slices` node listing the filtered CIs, categorical filters are stripped when Tableau round-trips the workbook.
3. **Sort nodes after filters**: Placing `shelf-sorts` or `computed-sort` after `filter` nodes in `view` children causes workbook load errors. Sort nodes must come before filter nodes.
4. **Using `function="filter"` for Top N**: This approach doesn't survive round-trips. Use `function="end"` with a nested `function="order"` child.
5. **Wrong `groupfilter level` format**: The `level` attribute on groupfilter uses CI format without the DS prefix: `[none:Segment:nk]` — not `[DS].[none:Segment:nk]` and not the raw field name `[Segment]`.
6. **Missing `filter-group` for cross-sheet sync**: Filters only synchronize across worksheets when they share the same `filter-group` integer. Without it, each worksheet's filter operates independently.

---

## Implementation

To add a categorical filter to a worksheet:

1. **Get the datasource ID** from `tableau-list-available-fields` (e.g. `federated.0abc123`).
2. **Add the column def + CI to `datasource-dependencies`** for the filtered field (if not already present).
3. **Construct the filter node** using `[DS].[[FieldName]]` format for the `column` attr, and `[none:FieldName:nk]` for the `groupfilter level` attr.
4. **Add or update the `slices` node** in `view` to reference the CI: `[DS].[none:FieldName:nk]`.
5. **Ensure filter nodes appear after any sort nodes** in `view` children ordering.
6. **Submit via `tableau-apply-workbook`** and inspect with `tableau-get-workbook` to confirm the filter survived.

For cross-sheet filters: repeat steps 1–5 for every worksheet that should respond to the filter, using the same `filter-group` integer on all filter nodes.

For context filters: add `context="true"` to the filter element. Context filters must appear before any FIXED LOD expressions that need to be scoped by them.
