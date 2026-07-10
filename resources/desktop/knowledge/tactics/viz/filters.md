# Workbook XML: Filters

Enforced-by: categorical-filter-slices, categorical-filter-proliferation

Filter patterns for all worksheet filter types in Tableau workbook XML. Each rule below is adjudicated against **real Tableau serializations** — Desktop's own oracle `.twb` saves, the shipped `data/data-visualization-templates-xml/*.xml` templates, and the graded w44 golden `.twb` saves (kept outside the repo in the `W44_GOLDENS_DIR` evidence store). Two rules earlier prose had inverted — **boolean casing** and **filter `column` format** — are corrected here (see the 2026-07-06 evidence audit; aligns with SE PR #167). Behavioral "silently fails / stripped / causes errors" claims are demoted to **unverified — needs live probe** (see the last section); do not restate them as fact until confirmed on the apply path.

---

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, refine, troubleshoot
- In-scope reason: Filters are a core authoring operation requiring the correct filter column format (column-instance form), `slices` nodes, enumeration semantics, sort/filter ordering, and filter-class-specific syntax.
- Out-of-scope risk: none
- Tags: filter, categorical, groupfilter, slices, date-filter, top-n, cross-sheet-filter, filter-group, measure-names-filter, context-filter, quantitative-filter, continuous-date-range, boolean-filter
- Relevant user prompts/search terms: "how do I filter a dimension to specific values", "add a Top N filter that survives round-trip", "create a cross-sheet filter across multiple worksheets", "filter on Measure Names to control crosstab measures", "date range filter syntax", "filter column format is wrong", "slices node required for filters", "Boolean filter values must be capitalized", "filter-group for synchronized filters", "context filter syntax"

## Filter placement in view

Filters live in `view` as siblings of `datasource-dependencies` and `aggregation`. A `slices` node listing all filtered column-instances is co-present in every serialization (`gantt-chart.xml:33-48`, dep → filter → slices → aggregation).

```
view
  datasources
  datasource-dependencies   ← column defs + CIs for filtered fields
  filter                    ← one per filtered field
  computed-sort / shelf-sorts   ← sorts and filters BOTH precede <slices>; Desktop often writes sorts AFTER filters
  slices                    ← lists all filtered column-instances
  aggregation
```

Column defs + column-instances for filtered fields appear in `datasource-dependencies` even when the field is not on rows/cols/encodings (always co-present in goldens; the "else fails" branch is untestable offline — see probe P5).

**Sort/filter ordering (corrected).** There is **no** "sort must precede filters" rule. The only ordering invariant the corpus supports is that sort nodes (`computed-sort`, `shelf-sorts`, `natural-sort`, `manual-sort`) **and** `<filter>` nodes both precede `<slices>` and `<aggregation>`. Desktop routinely places sorts **after** filters and even interleaves them:

```
</filter>
<shelf-sorts>          ← superbowl-live-styled2.twb:489 (shelf-sort immediately after a filter)
  <shelf-sort-v2 .../>
</shelf-sorts>
```

`waterfall-src.twb:38818-38821` alternates `filter` → `computed-sort`; `ww-ou-diff.xml:54-66` is filter → filter → `shelf-sorts` → `slices`. (Whether a sort placed *after* `<slices>` errors is unverified — probe P2.)

---

## Enumeration semantics

The outer `function` + `user:ui-enumeration` on the top groupfilter encodes intent:

| Intent | Outer `function` | `user:ui-enumeration` | Shape | Evidence |
|---|---|---|---|---|
| Include listed members | `union` (children `member`) or a single `member` | `inclusive` | list the members to keep | `waterfall-src.twb:38819`, `slope-oracle.twb:462` |
| Exclude listed members | `except` | `exclusive` | `level-members` + a `union` of members to drop | `waterfall-src.twb:31289`, `ww-ou-diff.xml:55` |
| All members (interactive control) | `level-members` | `all` | single node, no `member` children | `gantt-chart.xml:35` |

---

## Categorical filter (include specific values)

```xml
<filter column="[Sample - Superstore].[none:Segment:nk]" class="categorical">
  <groupfilter function="union"
               user:ui-domain="relevant"
               user:ui-enumeration="inclusive"
               user:ui-marker="enumerate">
    <groupfilter function="member" level="[none:Segment:nk]" member="Consumer" />
    <groupfilter function="member" level="[none:Segment:nk]" member="Corporate" />
  </groupfilter>
</filter>
```

**Format notes (corrected against disk):**
- `filter column` uses **column-instance (CI) format**: `[DS].[none:Segment:nk]` — the form Desktop serializes (`slope-oracle.twb:461`) and the repo ships (`gantt-chart.xml:34`). It is **not** double-bracket `[DS].[[Segment]]` (see "Filter column format" below).
- Outer `user:ui-enumeration` for an include is `"inclusive"` (not `"exclusive"`). `exclusive` is reserved for `function="except"` excludes (`waterfall-src.twb:31289`).
- `groupfilter level` uses CI format **without** the DS prefix: `[none:Segment:nk]` — not `[DS].[none:Segment:nk]`, not raw `[Segment]` (`gantt-chart.xml:35`).

### Exclude specific values

```xml
<filter column="[Sample - Superstore].[none:Segment:nk]" class="categorical">
  <groupfilter function="except"
               user:ui-domain="relevant"
               user:ui-enumeration="exclusive"
               user:ui-marker="enumerate">
    <groupfilter function="level-members" level="[none:Segment:nk]" />
    <groupfilter function="union">
      <groupfilter function="member" level="[none:Segment:nk]" member="Home Office" />
    </groupfilter>
  </groupfilter>
</filter>
```

Structure matches `ww-ou-diff.xml:55-61` (`except` wraps `level-members` + a `union` of the members to drop).

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

- `member` — the filter value as string (`"2024"`, `"4"` for quarter, `"Consumer"` for a dimension)
- `level` — the column-instance name (without DS prefix)

---

## Boolean field filter

Boolean members serialize **lowercase**: `member="true"` / `member="false"`. (Earlier prose had this backwards.)

```xml
<filter column="[Sample - Superstore].[usr:Calculation_9000000000000000028:nk]" class="categorical">
  <groupfilter function="member"
               level="[usr:Calculation_9000000000000000028:nk]"
               member="true"
               user:ui-domain="relevant"
               user:ui-enumeration="inclusive"
               user:ui-marker="enumerate" />
</filter>
```

This is `slope-oracle.twb:461-462` (Desktop's own save). A corpus-wide grep for `member=` boolean values returned **only** `true` (11 files, zero capitalized, zero `false`). Use lowercase; do not capitalize. Aligns with SE PR #167.

---

## Date filter column-instance naming

| Tableau filter | Column-instance name | derivation | type |
|---|---|---|---|
| Year | `[yr:Order Date:ok]` | `Year` | `ordinal` |
| Quarter | `[qr:Order Date:ok]` | `Quarter` | `ordinal` |
| Month | `[mn:Order Date:ok]` | `Month` | `ordinal` |
| Week | `[wk:Order Date:ok]` | `Week` | `ordinal` |

Confirmed on disk: `[yr:Order Date:ok]`, `[mn:Order Date:ok]`, `[qr:Date:ok]` all appear in `waterfall-src.twb`.

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

Column-instance: derivation `None`, type `quantitative`, suffix `qk`. Date strings use `#YYYY-MM-DD#`. Confirmed: `waterfall-src.twb:32081` (`[none:Date:qk]` in-range), `:33437` (`[none:Year:qk]` in-range).

---

## Cross-sheet filter (`filter-group`)

To make a filter on one worksheet also control other worksheets on the same dashboard, add the same filter to each target worksheet with the **same `filter-group` integer**. Tableau synchronizes filters sharing a `filter-group` across sheets (confirmed: identical `filter-group='13'` on the Chart Type filter across two sheets, `waterfall-src.twb:30266` and `:30377`).

Use `function="level-members"` with `user:ui-enumeration="all"` for an "all members selected" interactive control:

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

## Slices node

A `slices` node listing every filtered column-instance is present in `view` in every serialization:

```xml
<slices>
  <column>[Sample - Superstore].[yr:Order Date:ok]</column>
  <column>[Sample - Superstore].[none:Region:nk]</column>
</slices>
```

The repo's `categorical-filter-slices` rule warns (does not block) when a categorical filter has no matching `slices` column, noting Tableau **may** silently strip it on round-trip. Whether a missing `slices` node actually strips the filter is unverified offline (probe P1) — always include it.

---

## Filtering Measure Names (controlling which measures appear in a crosstab)

To show only specific measures in a Measure Names/Values crosstab, add a categorical filter on `[:Measure Names]`:

```xml
<filter column="[Sample - Superstore].[:Measure Names]" class="categorical">
  <groupfilter function="union" user:op="manual">
    <groupfilter function="member"
                 level="[:Measure Names]"
                 member="&quot;[Sample - Superstore].[sum:Sales:qk]&quot;" />
    <groupfilter function="member"
                 level="[:Measure Names]"
                 member="&quot;[Sample - Superstore].[sum:Profit:qk]&quot;" />
  </groupfilter>
</filter>
```

Confirmed on disk (`HUMAN-sets-correct.twb:3075-3079`):
- `member` values are **double-quoted fully-qualified column-instance refs** (XML-escaped `&quot;...&quot;`)
- `level` is `"[:Measure Names]"` (no DS prefix)
- also requires a `slices` node with `[DS].[:Measure Names]`

```xml
<slices>
  <column>[Sample - Superstore].[:Measure Names]</column>
</slices>
```

Caveat: the outer `union` in the golden carries `user:op="manual"`, **not** the `user:ui-domain="relevant"` earlier prose asserted. Which one the apply path requires/normalizes is unverified offline (probe P6).

---

## Top N filter (native `function="end"` groupfilter)

A Top N filter limits a dimension to its top N members by a measure, using nested groupfilters inside a categorical filter.

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

Confirmed structure: `HUMAN-sets-correct.twb:2728-2730` (`function="end"` → nested `function="order"` → `function="level-members"` + `user:ui-enumeration="all"`). Also requires a `slices` node referencing the filtered CI.

Key attrs:
- `count` — N. Serialized as a **literal string** (`"50"`) or as a **parameter reference** (`count="[Parameters].[Parameter 3]"`, per `HUMAN-sets-correct.twb:2728`).
- `end` — `"top"` (or `"bottom"`), paired with `direction`
- `direction` — `"DESC"` (top) or `"ASC"` (bottom)
- `expression` — the aggregation expression, e.g. `"SUM([ms_played])"`, `"SUM([Sales])"`
- `level` — the column-instance name (without DS prefix)

> **Note:** Use `function="end"`, not `function="filter"`. The `function="filter"` Top N form is unreliable; the `function="end"` pattern above is the confirmed approach.

---

## Context filter

Context filters run in step 3 of Tableau's Order of Operations (before dimension filters). Add `context="true"` to the filter node; the `column` is CI format like any other filter:

```xml
<filter column="[Sample - Superstore].[yr:Order Date:ok]" class="categorical" context="true">
  ...
</filter>
```

Confirmed: `waterfall-src.twb:38841` — `context='true'` on a CI-format column (`[yr:Order Date:ok]`), not double-bracket. Context filters must precede any FIXED LOD expressions that need to be scoped by them.

---

## Filter column format

The `column` attribute on a `<filter>` node uses **column-instance (CI) format**:

- `[DS].[none:Field:nk]` (dimension), `[DS].[yr:Field:ok]` (date part), `[DS].[none:Field:qk]` (continuous), `[DS].[:Measure Names]`.

This is what Desktop serializes (`slope-oracle.twb:461`, `gantt2-oracle.twb:459`) and what the repo's shipped apply-path templates use (`gantt-chart.xml:34,37,40`). The repo's validation rule states filter column formats **vary** ("raw field references, column-instance references, dates, `[:Measure Names]`, and Top-N patterns all show up", `categorical-filter-slices.ts:5-7`) and matches on the local field name, not a bracket shape.

Double-bracket `[DS].[[Field]]` is **not** a filter column form. In Tableau XML the `[[…]]` shape appears only as a **table-object id**, e.g. `[__tableau_internal_object_id__].[[Orders_ECFCA1FB690A41FE803BC071773BA862]]]` (`gantt-workbook-cache.xml:413`). (Whether the apply pipeline *rejects* double-bracket filter input is the inverse question — unverified offline, probe P3.)

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

- **Filter `column` uses CI format** — `[DS].[none:Field:nk]` / `[DS].[yr:Field:ok]` / `[DS].[:Measure Names]` — the form Desktop emits and the repo ships (`gantt-chart.xml:34`; `slope-oracle.twb:461`). Double-bracket `[[Field]]` is a table-object id, not a filter column (`gantt-workbook-cache.xml:413`).
- **Boolean members are lowercase** — `member="true"` / `member="false"` (`slope-oracle.twb:462`; zero capitalized in the corpus). Aligns with SE PR #167.
- **Match enumeration to intent** — include: `function="union"`/`member` + `user:ui-enumeration="inclusive"`; exclude: `function="except"` + `user:ui-enumeration="exclusive"`; all-members control: `function="level-members"` + `user:ui-enumeration="all"` (`waterfall-src.twb:38819` / `:31289`; `gantt-chart.xml:35`).
- **Order: sorts and filters both precede `<slices>`/`<aggregation>`** — there is no "sort before filters" rule; Desktop commonly writes sorts after/among filters (`superbowl-live-styled2.twb:489`; `waterfall-src.twb:38821`).
- **Use `function="end"` for Top N** — not `function="filter"`; nest `function="order"` then `function="level-members"` + `user:ui-enumeration="all"` (`HUMAN-sets-correct.twb:2728-2730`).
- **Add a `slices` node** listing every filtered CI — present in every serialization (`gantt-chart.xml:43-47`).
- **Use the same `filter-group` integer** on all worksheets that should synchronize a cross-sheet filter (`waterfall-src.twb:30266`/`:30377`).

---

## Common Mistakes

1. **Double-bracket filter column**: using `[DS].[[Region]]` for the `column` attr. Desktop and shipped templates use CI format `[DS].[none:Region:nk]`; double-bracket is a table-object id (`gantt-workbook-cache.xml:413`).
2. **Capitalizing boolean members**: `"True"`/`"False"` do not appear on disk. Booleans serialize lowercase `"true"`/`"false"` (`slope-oracle.twb:462`).
3. **Labeling an include with `ui-enumeration="exclusive"`**: includes use `inclusive`; `exclusive` is for `function="except"` excludes (`waterfall-src.twb:38819` vs `:31289`).
4. **Assuming sorts must precede filters**: they need not — sorts and filters both precede `<slices>`, and Desktop writes sorts after filters (`superbowl-live-styled2.twb:489`).
5. **Using `function="filter"` for Top N**: use `function="end"` with a nested `function="order"` child.
6. **Wrong `groupfilter level` format**: use CI without the DS prefix — `[none:Segment:nk]`, not `[DS].[none:Segment:nk]`, not raw `[Segment]`.
7. **Missing `filter-group` for cross-sheet sync**: filters synchronize only when they share the same `filter-group` integer.

---

## Implementation

To add a categorical filter to a worksheet:

1. **Get the datasource ID** from `tableau-list-available-fields` (e.g. `federated.0abc123`).
2. **Add the column def + CI to `datasource-dependencies`** for the filtered field (if not already present).
3. **Construct the filter node** using **CI format** for the `column` attr (`[DS].[none:Field:nk]`) and `[none:Field:nk]` for the `groupfilter level` attr; set enumeration to match intent (`inclusive` for include, `exclusive` for `except`).
4. **Add or update the `slices` node** in `view` to reference the CI.
5. **Order** sorts and filters before `<slices>`/`<aggregation>` (sorts may sit after or among filters).
6. **Submit via `tableau-apply-workbook`** and inspect with `tableau-get-workbook` to confirm the filter survived.

For cross-sheet filters: repeat steps 1–5 for every worksheet that should respond, using the same `filter-group` integer. For context filters: add `context="true"` to the filter node.

---

## Unverified — needs live probe

The following are behavioral/causal claims not observable in serialized XML alone. Treat as unconfirmed until settled by a live probe (author XML → `tableau-apply-workbook` → `tableau-get-workbook` readback → diff; Superstore, one worksheet):

- **P1** — Does a categorical filter with **no** `<slices>` get stripped on round-trip? (The `categorical-filter-slices` rule only warns.)
- **P2** — Does a sort placed **after** `<slices>` load/round-trip or error? (No golden violates the slices boundary.)
- **P3** — Does the apply path **reject** double-bracket `[DS].[[Field]]` filter input vs CI `[DS].[none:Field:nk]`? (Confirms the inverse of the corrected column-format rule.)
- **P5** — Does a filtered field with **no** column def/CI in `datasource-dependencies` get stripped or error?
- **P6** — Does the Measure Names outer `union` require/normalize `user:op="manual"` vs `user:ui-domain="relevant"`?

---

## Source and Confidence

- Source/evidence type: field-tested + evidence-audited against real Tableau serializations
- Source: Filter XML patterns adjudicated 2026-07-06 against Desktop oracle `.twb` saves, shipped `data-visualization-templates-xml/*` templates, and the graded w44 golden `.twb` saves (external `W44_GOLDENS_DIR` evidence store); inline citations name the strongest disk evidence per rule. Supersedes prior prose that had boolean casing and filter-column format inverted (aligns with SE PR #167). Customer-identifying details removed.
- Customer-identifying details removed: yes
- Confidence: field-tested for the serialization facts (column format, boolean casing, enumeration, sort/filter ordering, Top-N, date, cross-sheet, Measure Names, context). The behavioral "silently fails / stripped / errors / required" claims are **unverified** pending live apply probes P1–P6.
- Last reviewed: 2026-07-06
