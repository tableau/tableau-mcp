# Table Calculations — XML Patterns

Complete empirically-confirmed reference for all table calculation types in Tableau Desktop: Quick Table Calcs (applied to native measures) and custom `derivation="User"` calculated fields. All patterns captured via `get-worksheet-xml` after manual authoring (2026-06-25).

**⇒ Wrong-fork check (live Desktop):** CREATING a running total / moving average / rank on a running Tableau Desktop via the External API? Do NOT hand-edit worksheet or workbook XML with these patterns — author it with the `author-calc` verb (author-parameter / author-set first when the calc depends on them), then chart the authored caption. Last resort, only when no authoring verb or template can express the structure: round-trip the REAL document with the workbook document read/apply tools — see `calc-fields.md`. These XML patterns are for file-mode authoring and for READING existing table calcs.

---

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, validate, troubleshoot
- In-scope reason: Empirically confirmed Tableau XML patterns that directly govern how agents correctly author worksheet XML.
- Out-of-scope risk: none
- Tags: table-calculations, quick-table-calc, user-derivation, running-total, percent-difference, percent-of-total, rank, percentile, moving-average, ytd-total, yoy-growth-rate, compute-using, table-calc-filter, nested-table-calcs
- Relevant user prompts/search terms: "running total table across", "percent difference previous mark", "YTD growth rate stacked calc", "compute using specific dimension", "RANK competition descending", "moving average 3-period window", "INDEX SIZE FIRST LAST position-only", "table calc filter Top N quantitative range", "ordering-type Field ordering-field", "multiple table-calc children nested", "how do I write a table calculation", "how do I create a table calc", "add a table calculation"

## When to Use

Use this module when you need to:
- **Write a quick table calc** — know the exact `<table-calc>` attributes and CI name prefix
- **Write a custom table calc field** (`derivation="User"`) — know the correct `<column>` and `<column-instance>` shape
- **Read a workbook with table calcs** — identify what type and Compute Using is configured
- **Set Compute Using** — know the exact `ordering-type` string for each UI option
- **Compose table calcs** — understand how YTD Growth Rate stacks two `<table-calc>` elements

---

## Best Practices

### Quick table calcs (applied to native measures)
- **`<table-calc>` is a child of `<column-instance>` only** — never on the `<column>` def. Quick table calcs do not modify the column definition at all.
- **`derivation="User"` is NOT used for quick table calcs** — quick table calcs keep the original aggregation derivation (e.g. `Sum`) and add `<table-calc>` children to the CI.
- **Multiple `<table-calc>` children can be stacked** on one `<column-instance>` for composed operations (e.g. YTD Growth Rate = CumTotal + PctDiff).
- **The CI name prefix chains the nested operations** — `pcdf:cum:sum:Sales:qk` reads right to left: SUM → cumulative → percent diff.

### Custom table calc fields (`derivation="User"`)
- **Always include `<table-calc ordering-type="Rows"/>` inside `<calculation>`** on the `<column>` def — Tableau adds it on round-trip regardless; include it upfront for idempotent XML.
- **Always set Compute Using on the `<column-instance>` `<table-calc>`, not the `<column><calculation><table-calc>`.** The `<column>` node holds the field's definition-level default (leave at `Rows`). The `<column-instance>` node is the per-shelf-use override — this is what actually controls the computation.
- **Never omit `<table-calc>` from a `derivation="User"` `<column-instance>`.** If omitted, Tableau fills it in from the field's definition default — which may be `Field` ordering pointing to a specific dimension. Always write `<table-calc ordering-type="Rows"/>` explicitly unless you intend a specific ordering.
- **`datatype` rules by formula:** `integer` for `RANK`, `SIZE`, `FIRST`, `LAST`, `INDEX`; `real` for everything else. `RANK` silently overrides `real` → `integer` on round-trip — declare `integer` upfront.
- **Position-only functions omit measure deps:** `SIZE()`, `FIRST()`, `LAST()`, `INDEX()` reference no measure — omit the measure `<column>` from `<datasource-dependencies>` for those calcs. Tableau drops it automatically.

---

## Common Mistakes

1. **Putting `<table-calc>` on `<column>` instead of `<column-instance>`** for quick table calcs — it belongs only on the CI.
2. **Using `derivation="User"` for a quick table calc** — use the underlying aggregation derivation (e.g. `Sum`) and add `<table-calc>` children.
3. **Wrong `ordering-type` string** — XML values don't match UI labels (e.g. "Table (across)" = `Rows`, not `Across`). Use the table below.
4. **Omitting `ordering-field` when `ordering-type="Field"`** — specific dimension requires both attributes.
5. **Omitting `<table-calc>` from a `derivation="User"` CI** — Tableau fills in the field's definition default, which may not be `Rows`.
6. **Declaring `datatype="real"` for `RANK()`** — Tableau corrects to `integer`. Declare `integer` upfront.
7. **Including a measure column in deps for position-only calcs** — Tableau drops it, causing a round-trip diff.

---

## Implementation

### Quick table calc types

| UI name | `type` value | CI prefix | Required extra attributes |
|---|---|---|---|
| Running Total | `CumTotal` | `cum:` | `aggregation` |
| Difference | `Difference` | `diff:` | `diff-options`, `<address>` |
| Percent Difference | `PctDiff` | `pcdf:` | `diff-options`, `<address>` |
| Percent of Total | `PctTotal` | `pcto:` | — |
| Rank | `Rank` | `rank:` | `rank-options` |
| Percentile | `PctRank` | `pcrk:` | `rank-options` |
| Moving Average | `WindowTotal` | `win:` | `aggregation`, `from`, `to`, `window-options` |

### Composed / date-aware quick table calcs

| UI name | Composition | CI prefix pattern |
|---|---|---|
| YTD Total | `CumTotal` + `level-break` | `cum:` |
| YTD Growth Rate | `CumTotal` stacked with `PctDiff` (two `<table-calc>` children) | `pcdf:cum:` |
| Year over Year Growth Rate | `PctDiff` + `level-address` | `pcdf:` |
| Compound Growth Rate | `PctDiff` + `diff-options="Relative,Compounded"` | `pcdf:` |

### Custom `derivation="User"` calc field types

All formula types produce an identical `<table-calc>` shape — the only differences are `datatype` and whether a measure dep is needed:

| Formula type | `datatype` | Measure dep needed | Notes |
|---|---|---|---|
| `RUNNING_SUM(SUM([Sales]))` | `real` | yes | |
| `WINDOW_AVG(SUM([Sales]))` | `real` | yes | |
| `TOTAL(SUM([Sales]))` | `real` | yes | |
| `RANK(SUM([Sales]))` | `integer` | yes | Tableau overrides `real` → `integer` |
| `INDEX()` | `integer` | no | Position-only |
| `SIZE()` | `integer` | no | Position-only |
| `FIRST()` | `integer` | no | Position-only |
| `LAST()` | `integer` | no | Position-only |
| `RUNNING_SUM(INDEX())` | `integer` | no | Outer inherits inner's integer type; position-only dep rule applies |

### `ordering-type` values (Compute Using)

All 10 values confirmed valid for both quick table calcs and `derivation="User"` fields:

| UI label | `ordering-type` value |
|---|---|
| Table (across) | `Rows` |
| Table (down) | `Columns` |
| Table (across then down) | `Table` |
| Table (down then across) | `TableCol` |
| Pane (across) | `RowInPane` |
| Pane (down) | `ColumnInPane` |
| Pane (across then down) | `Pane` |
| Pane (down then across) | `PaneCol` |
| Cell | `CellInPane` |
| Specific Dimension | `Field` — also requires `ordering-field="[datasource].[fieldname]"` |

### `<table-calc>` attribute reference

| Attribute | Used by | Values / notes |
|---|---|---|
| `type` | quick table calcs only | See type table above |
| `ordering-type` | all | See ordering-type table above |
| `ordering-field` | `ordering-type="Field"` | Fully-qualified field reference: `[datasource].[fieldname]` |
| `aggregation` | `CumTotal`, `WindowTotal` | `Sum`, `Avg`, etc. |
| `diff-options` | `Difference`, `PctDiff` | `Relative` / `Relative,Compounded` |
| `rank-options` | `Rank`, `PctRank` | `Competition,Descending` / `Competition,Ascending` |
| `from` / `to` | `WindowTotal` | Integer offsets; e.g. `from="-2" to="0"` for 3-period window |
| `window-options` | `WindowTotal` | `IncludeCurrent` |
| `level-break` | `CumTotal` (YTD) | Fully-qualified CI ref — field at which accumulation resets |
| `level-address` | `PctDiff` (YoY) | Fully-qualified CI ref — level at which the address offset is applied |
| `<address><value>` | `Difference`, `PctDiff` | Integer offset: `-1` = previous mark, `-2` = two back |

### Two-node model for `derivation="User"` fields

Custom table calc fields have `<table-calc>` in two places with independent roles:

```
<column><calculation><table-calc ordering-type="Rows"/>   ← definition default (leave alone)
<column-instance><table-calc ordering-type="Rows"/>       ← per-shelf Compute Using (set this)
```

- The `<column>` node stores the default set in "Edit Table Calculation" on the field definition. Tableau writes `Rows` by default; only changes if the user explicitly saves a different default.
- The `<column-instance>` node is the active Compute Using for this specific shelf placement. This is what the agent should set.
- If CI `<table-calc>` is omitted, Tableau fills it from the `<column>` default — which may be `Field` ordering pointing to a specific dimension. Never omit it.

### Confirmed XML examples

#### Quick table calc — Running Total (Table across)
```xml
<column-instance column="[Sales]" derivation="Sum" name="[cum:sum:Sales:qk]" pivot="key" type="quantitative">
  <table-calc aggregation="Sum" ordering-type="Rows" type="CumTotal"/>
</column-instance>
```

#### Quick table calc — Difference (Table across)
```xml
<column-instance column="[Sales]" derivation="Sum" name="[diff:sum:Sales:qk]" pivot="key" type="quantitative">
  <table-calc diff-options="Relative" ordering-type="Rows" type="Difference">
    <address>
      <value>-1</value>
    </address>
  </table-calc>
</column-instance>
```

#### Quick table calc — Percent of Total
```xml
<column-instance column="[Sales]" derivation="Sum" name="[pcto:sum:Sales:qk]" pivot="key" type="quantitative">
  <table-calc ordering-type="Rows" type="PctTotal"/>
</column-instance>
```
The `pcto:` prefix must match the BASE measure's aggregation: `pcto:sum:` for a SUM base, `pcto:ctd:` for a CountDistinct base, `pcto:cnt:` for a Count base. Copying the `sum:` form for a COUNTD measure produces wrong totals (the percent is taken against the wrong denominator). See `expertise://tableau/strategy/analytics/calc-fields-strategy`.

#### Quick table calc — Rank (Competition Descending)
```xml
<column-instance column="[Sales]" derivation="Sum" name="[rank:sum:Sales:qk]" pivot="key" type="quantitative">
  <table-calc ordering-type="Rows" rank-options="Competition,Descending" type="Rank"/>
</column-instance>
```

#### Quick table calc — Moving Average (3-period)
```xml
<column-instance column="[Sales]" derivation="Sum" name="[win:sum:Sales:qk]" pivot="key" type="quantitative">
  <table-calc aggregation="Avg" from="-2" ordering-type="Rows" to="0" type="WindowTotal" window-options="IncludeCurrent"/>
</column-instance>
```

#### Quick table calc — YTD Total
```xml
<column-instance column="[Sales]" derivation="Sum" name="[cum:sum:Sales:qk]" pivot="key" type="quantitative">
  <table-calc aggregation="Sum" level-break="[Sample - Superstore].[qr:Order Date:ok]"
              ordering-field="[Sample - Superstore].[Order Date]" ordering-type="Field" type="CumTotal"/>
</column-instance>
```

#### Quick table calc — Year over Year Growth Rate
```xml
<column-instance column="[Sales]" derivation="Sum" name="[pcdf:sum:Sales:qk]" pivot="key" type="quantitative">
  <table-calc diff-options="Relative" level-address="[Sample - Superstore].[yr:Order Date:ok]"
              ordering-field="[Sample - Superstore].[Order Date]" ordering-type="Field" type="PctDiff">
    <address>
      <value>-1</value>
    </address>
  </table-calc>
</column-instance>
```

#### Quick table calc — YTD Growth Rate (two stacked `<table-calc>` children)
```xml
<column-instance column="[Sales]" derivation="Sum" name="[pcdf:cum:sum:Sales:qk]" pivot="key" type="quantitative">
  <table-calc aggregation="Sum" level-break="[Sample - Superstore].[qr:Order Date:ok]"
              ordering-field="[Sample - Superstore].[Order Date]" ordering-type="Field" type="CumTotal"/>
  <table-calc diff-options="Relative" level-address="[Sample - Superstore].[yr:Order Date:ok]"
              ordering-field="[Sample - Superstore].[Order Date]" ordering-type="Field" type="PctDiff">
    <address>
      <value>-1</value>
    </address>
  </table-calc>
</column-instance>
```

#### Custom calc — RUNNING_SUM (measure-referencing)
```xml
<column caption="Running Sum" datatype="real" name="[Calculation_RunSum]" role="measure" type="quantitative">
  <calculation class="tableau" formula="RUNNING_SUM(SUM([Sales]))">
    <table-calc ordering-type="Rows"/>
  </calculation>
</column>
<column-instance column="[Calculation_RunSum]" derivation="User" name="[usr:Calculation_RunSum:qk]" pivot="key" type="quantitative">
  <table-calc ordering-type="Rows"/>
</column-instance>
```

#### Custom calc — INDEX() (position-only — no measure dep)
```xml
<column caption="Index" datatype="integer" name="[Calculation_INDEX]" role="measure" type="quantitative">
  <calculation class="tableau" formula="INDEX()">
    <table-calc ordering-type="Rows"/>
  </calculation>
</column>
<column-instance column="[Calculation_INDEX]" derivation="User" name="[usr:Calculation_INDEX:qk]" pivot="key" type="quantitative">
  <table-calc ordering-type="Rows"/>
</column-instance>
```

### Nested calc fields — multiple `<table-calc>` children with `field` attribute

When a `User` calc field's formula references another `User` calc field (e.g. `RANK([Calculation_RunningSum])`), the outer CI gets one `<table-calc>` per nested calc level:

```xml
<column-instance column="[Calculation_Outer]" derivation="User" name="[usr:Calculation_Outer:qk]" pivot="key" type="quantitative">
  <table-calc ordering-type="ColumnInPane"/>
  <table-calc field="[Sample - Superstore].[Calculation_Inner]" ordering-type="Columns"/>
</column-instance>
```

- First `<table-calc>` (no `field`) = Compute Using for the outer calc
- Subsequent `<table-calc>` nodes each carry `field="[datasource].[inner-calc-name]"` = Compute Using for each referenced inner calc field
- The inner calc field does NOT get its own CI on the shelf

**This is distinct from nesting functions within a single formula** (e.g. `RANK(RUNNING_SUM(SUM([Sales])))`). A single formula with multiple table calc functions still produces only one `<table-calc>` on the CI — there is only one Compute Using setting for the whole formula.

### Same field placed twice — full pattern

For shelf notation (`*`/`/`/`+` operators) and the CI disambiguation suffix (`:N`), see `expertise://tableau/tactics/tree/column-instance-prefixes`.

Each placement gets its own independent `<column-instance>`, suffix, and `<pane>` entry:

```xml
<column-instance column="[Calculation_6340831328333826]" derivation="User"
                 name="[usr:Calculation_6340831328333826:qk]" pivot="key" type="quantitative">
  <table-calc ordering-type="Rows"/>
</column-instance>
<column-instance column="[Calculation_6340831328333826]" derivation="User"
                 name="[usr:Calculation_6340831328333826:qk:3]" pivot="key" type="quantitative">
  <table-calc ordering-type="CellInPane"/>
</column-instance>

<rows>([Sample - Superstore].[none:Category:nk] * ([Sample - Superstore].[usr:Calculation_6340831328333826:qk] + [Sample - Superstore].[usr:Calculation_6340831328333826:qk:3]))</rows>

<!-- Each instance gets its own pane — see pane-structure.md -->
<pane id="2" y-axis-name="[Sample - Superstore].[usr:Calculation_6340831328333826:qk]">...</pane>
<pane id="3" y-axis-name="[Sample - Superstore].[usr:Calculation_6340831328333826:qk:3]">...</pane>
```

For pane structure rules, see `expertise://tableau/tactics/viz/pane-structure`.

## When to Say No

This file is a technical XML reference, not authoring guidance. Do not apply these patterns to non-XML contexts (e.g. Tableau Cloud REST API, Tableau Prep, or Hyper files).

## Source and Confidence

- Source/evidence type: field-tested
- Source: Empirical XML injection + round-trip inspection via `apply-worksheet` / `get-worksheet-xml`, Tableau Desktop, Sample - Superstore datasource
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-25
