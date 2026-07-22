# Pane Structure in Worksheet XML

How Tableau's `<panes>` section changes based on shelf configuration. Panes are
the per-axis rendering contexts that Tableau uses to track independent axes,
mark encoding, and selection behaviour.

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, validate, troubleshoot
- In-scope reason: Empirically confirmed Tableau XML patterns that directly govern how agents correctly author worksheet XML.
- Out-of-scope risk: none
- Tags: pane, panes, y-axis-name, x-axis-name, multi-measure, dual-axis, mark-class, breakdown, rows, cols, table-calc, pane-multiplication
- Relevant user prompts/search terms: "how many panes for multiple measures on rows", "y-axis-name vs x-axis-name when to use", "panes multiply when measures share the same shelf", "different mark class per axis in combo chart", "anchor pane has no id", "scatter plot one measure per shelf", "table calc treated same as measure for panes", "pane id values start at 1", "named panes for per-axis mark overrides", "encoding lands on wrong pane"

## When to Use

Consult this file whenever you are:

- Authoring a worksheet that puts multiple measures on the same shelf (dual-axis
  or multi-measure rows/cols)
- Customising mark class per axis (e.g. bar + line combo charts)
- Diagnosing "wrong axis" bugs where a mark encoding lands on the wrong pane
- Writing pane XML from scratch after `apply-worksheet` round-trips

## Best Practices

- **One measure per shelf, one dimension per shelf → single unnamed pane.** You
  never need more than the baseline anchor pane for these layouts.
- **Multiple measures on the same shelf → always emit all named panes.** Tableau
  adds them on read-back; omit them on write-in and Tableau will regenerate them,
  but include them when you need to target per-axis mark settings.
- **`y-axis-name` vs `x-axis-name`:** Use `y-axis-name` when the measures are on
  Rows; use `x-axis-name` when the measures are on Cols. The attribute name tracks
  the axis the pane controls.
- **Pane `id` values start at `1`** for named panes. The anchor (unnamed) pane has
  no `id`. Ids are assigned in left-to-right, top-to-bottom shelf order.
- **Table calcs behave identically to regular measures** for pane-multiplication
  purposes — one extra pane per calc field added to a multi-measure shelf.
- When writing XML from scratch, the minimal safe anchor pane is:
  ```xml
  <pane selection-relaxation-option="selection-relaxation-allow">
    <view><breakdown value="auto"/></view>
    <mark class="Automatic"/>
  </pane>
  ```
  Tableau will append named panes for each measure on read-back; you do not need
  to pre-populate them unless you need per-axis mark overrides.

## Common Mistakes

- **Omitting named panes when mark class differs per axis.** If you want bars for
  Sales and a line for Profit, you must emit `<pane id="1">` and `<pane id="2">`
  with distinct `<mark class="..."/>` values. Omitting them collapses both axes to
  the anchor mark class.
- **Using `y-axis-name` for a measure on Cols.** Tableau uses `x-axis-name` when
  the measure is on the Cols shelf. Swapping the attribute causes silent failures
  where mark settings are not applied.
- **Assuming scatter-plots multiply panes.** One measure on Rows + one different
  measure on Cols = a single unnamed pane. Panes only multiply when two or more
  measures share the *same shelf*.
- **Hard-coding `id` on the anchor pane.** Tableau silently strips any `id`
  attribute from the anchor pane on round-trip — it is safe to submit but the
  attribute will not be preserved. Do not rely on it.

## Implementation

### Summary table

| Test | Rows | Cols | Pane count | `id` attrs | Axis attr | Notes |
|------|------|------|-----------|------------|-----------|-------|
| 1 | SUM(Sales) | Category | 1 | none | none | Simplest baseline |
| 2 | SUM(Sales) + SUM(Profit) | Category | 3 | 1, 2 | `y-axis-name` | Anchor + 1 per measure |
| 3 | Category | SUM(Sales) | 1 | none | none | Transposed T1; still 1 pane |
| 4 | Category | SUM(Sales) + SUM(Profit) | 3 | 1, 2 | `x-axis-name` | Mirror of T2 on cols shelf |
| 5 | SUM(Sales) | SUM(Profit) | 1 | none | none | Scatter: measures on *different* shelves |
| 6 | SUM(Sales) + Running Sum Calc | Category | 3 | 1, 2 | `y-axis-name` | Table calc treated same as regular measure |

### Test 1 — Single measure on Rows, dimension on Cols

```xml
<panes>
  <pane selection-relaxation-option="selection-relaxation-allow">
    <view>
      <breakdown value="auto"/>
    </view>
    <mark class="Automatic"/>
  </pane>
</panes>
```

Rows: `[Sample - Superstore].[sum:Sales:qk]`
Cols: `[Sample - Superstore].[none:Category:nk]`

One unnamed anchor pane. No `id`, no axis attribute.

---

### Test 2 — Two measures on Rows, dimension on Cols

```xml
<panes>
  <pane selection-relaxation-option="selection-relaxation-allow">
    <view>
      <breakdown value="auto"/>
    </view>
    <mark class="Automatic"/>
  </pane>
  <pane id="1" selection-relaxation-option="selection-relaxation-allow" y-axis-name="[Sample - Superstore].[sum:Sales:qk]">
    <view>
      <breakdown value="auto"/>
    </view>
    <mark class="Automatic"/>
  </pane>
  <pane id="2" selection-relaxation-option="selection-relaxation-allow" y-axis-name="[Sample - Superstore].[sum:Profit:qk]">
    <view>
      <breakdown value="auto"/>
    </view>
    <mark class="Automatic"/>
  </pane>
</panes>
```

Rows: `([Sample - Superstore].[sum:Sales:qk] + [Sample - Superstore].[sum:Profit:qk])`
Cols: `[Sample - Superstore].[none:Category:nk]`

Three panes: one unnamed anchor + one named pane per measure. Named panes carry
`y-axis-name` pointing to the full column reference of the measure they represent.
Ids are assigned in shelf order (Sales first = id 1, Profit second = id 2).

---

### Test 3 — Measure on Cols, dimension on Rows

```xml
<panes>
  <pane selection-relaxation-option="selection-relaxation-allow">
    <view>
      <breakdown value="auto"/>
    </view>
    <mark class="Automatic"/>
  </pane>
</panes>
```

Rows: `[Sample - Superstore].[none:Category:nk]`
Cols: `[Sample - Superstore].[sum:Sales:qk]`

Single unnamed anchor pane — identical structure to Test 1. Swapping the measure
to Cols does not add panes when there is only one measure.

---

### Test 4 — Two measures on Cols, dimension on Rows

```xml
<panes>
  <pane selection-relaxation-option="selection-relaxation-allow">
    <view>
      <breakdown value="auto"/>
    </view>
    <mark class="Automatic"/>
  </pane>
  <pane id="1" selection-relaxation-option="selection-relaxation-allow" x-axis-name="[Sample - Superstore].[sum:Sales:qk]">
    <view>
      <breakdown value="auto"/>
    </view>
    <mark class="Automatic"/>
  </pane>
  <pane id="2" selection-relaxation-option="selection-relaxation-allow" x-axis-name="[Sample - Superstore].[sum:Profit:qk]">
    <view>
      <breakdown value="auto"/>
    </view>
    <mark class="Automatic"/>
  </pane>
</panes>
```

Rows: `[Sample - Superstore].[none:Category:nk]`
Cols: `([Sample - Superstore].[sum:Sales:qk] + [Sample - Superstore].[sum:Profit:qk])`

Three panes, same count as Test 2. The axis attribute flips from `y-axis-name` to
`x-axis-name` because the measures live on the Cols shelf.

---

### Test 5 — Measure on Rows, measure on Cols (scatter-style)

```xml
<panes>
  <pane selection-relaxation-option="selection-relaxation-allow">
    <view>
      <breakdown value="auto"/>
    </view>
    <mark class="Automatic"/>
  </pane>
</panes>
```

Rows: `[Sample - Superstore].[sum:Sales:qk]`
Cols: `[Sample - Superstore].[sum:Profit:qk]`

Single unnamed anchor pane. The two measures are on *different* shelves so there
is no pane multiplication — each shelf has exactly one measure and Tableau treats
it as a standard XY encoding.

---

### Test 6 — Regular measure + table calc both on Rows, dimension on Cols

```xml
<panes>
  <pane selection-relaxation-option="selection-relaxation-allow">
    <view>
      <breakdown value="auto"/>
    </view>
    <mark class="Automatic"/>
  </pane>
  <pane id="1" selection-relaxation-option="selection-relaxation-allow" y-axis-name="[Sample - Superstore].[sum:Sales:qk]">
    <view>
      <breakdown value="auto"/>
    </view>
    <mark class="Automatic"/>
  </pane>
  <pane id="2" selection-relaxation-option="selection-relaxation-allow" y-axis-name="[Sample - Superstore].[usr:Calculation_6340831328333826:qk]">
    <view>
      <breakdown value="auto"/>
    </view>
    <mark class="Automatic"/>
  </pane>
</panes>
```

Rows: `([Sample - Superstore].[sum:Sales:qk] + [Sample - Superstore].[usr:Calculation_6340831328333826:qk])`
Cols: `[Sample - Superstore].[none:Category:nk]`

Three panes: identical pattern to Test 2. The `usr:` prefix column-instance is used
as-is in `y-axis-name` — Tableau does not normalise it to a simpler reference.

**Side observation on table-calc rewriting:** When Tableau round-trips a worksheet
with a table calc, it may rewrite the `<table-calc>` inside the `<column>` definition
from `ordering-type="Rows"` to `ordering-type="Field"` with an explicit
`ordering-field="[Sample - Superstore].[Category]"`. The `<column-instance>` CI keeps
`ordering-type="Rows"`. This is Tableau resolving the "Rows" shorthand against the
actual partition field on the view; it is safe to write either form on input.

---

## Conclusions

1. **Panes multiply only when two or more measures share the same shelf.** One
   measure on Rows + one on Cols = 1 pane. Two measures on Rows = 3 panes.

2. **The anchor pane (no `id`) is always present.** It holds the default mark class
   and view breakdown for the whole worksheet. Named panes supplement it; they do
   not replace it.

3. **`y-axis-name` vs `x-axis-name` tracks which shelf the measures are on,** not
   which visual axis the chart uses. Rows shelf → `y-axis-name`; Cols shelf →
   `x-axis-name`.

4. **Named pane ids start at 1 and increment in shelf order.** The first measure in
   the shelf expression gets `id="1"`, the second gets `id="2"`, and so on.

5. **Table calcs are treated identically to aggregated measures** for pane-
   multiplication purposes: one named pane per measure regardless of whether the
   field is a `sum:` or `usr:` derivation.

## When to Say No

This file is a technical XML reference, not authoring guidance. Do not apply these patterns to non-XML contexts (e.g. Tableau Cloud REST API, Tableau Prep, or Hyper files).

## Source and Confidence

- Source/evidence type: field-tested
- Source: Empirical XML injection + round-trip inspection via `apply-worksheet` / `get-worksheet-xml`, Tableau Desktop, Sample - Superstore datasource
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-25
