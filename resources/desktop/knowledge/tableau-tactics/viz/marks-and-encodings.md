# Workbook XML: Encodings and Mark Types

Expert reference for all Tableau marks card encodings, mark types, label styling, color palettes, and chart-type-specific patterns (Gantt, map, aggregation, sorting). All patterns confirmed via `tableau-get-workbook` observation after manual authoring.

---

## Encoding placement (critical)

All marks card encodings go inside an `<encodings>` element that is a **direct child of `<pane>`** — a sibling to `<view>` and `<mark>`, NOT nested inside the pane's `<view>` child. Encodings placed inside `<view>` are stripped on round-trip.

```
<pane>
  <view>        ← contains breakdown, aggregation, datasource-dependencies
  <mark>        ← mark type
  <encodings>   ← color, lod, size, text go here (NOT inside view)
    <color .../>
    <lod .../>
    <size .../>
```

The field must also have a `column` def and `column-instance` declared in `datasource-dependencies`.

**LOD co-dependency:** LOD encodings and their column-instances are co-dependent — Tableau strips both if either is missing. Always submit LOD encodings and their column-instances together in the same `tableau-apply-workbook` call.

---

## Color encoding

```xml
<color column="[Sample - Superstore].[none:Category:nk]"/>
```

---

## Size encoding (field-driven)

```xml
<size column="[Sample - Superstore].[avg:Actual Days to Ship:qk]"/>
```

Used for Gantt bar length (duration), bubble size on scatter plots, etc.

---

## Size (fixed/manual)

To set a fixed mark size (not driven by a field), add two elements as **direct children of `<pane>`**:

```xml
<mark-sizing mark-sizing-setting="marks-scaling-off"/>
<style>
  <style-rule element="mark">
    <format attr="size" value="2"/>
  </style-rule>
</style>
```

- `marks-scaling-off` disables automatic size scaling
- `value`: observed `"2"` = small; higher = larger

---

## Detail (LOD) encoding

```xml
<encodings>
  <lod column="[Sample - Superstore].[none:Order ID:nk]"/>
</encodings>
```

**Does NOT work** (stripped on round-trip): `slices`, `level` with `field` attr, `encoding type=level`.

---

## Text (label) encoding

```xml
<text column="[Sample - Superstore].[sum:Sales:qk]"/>
```

Multiple text fields are supported — add multiple `<text>` children in order; Tableau renders them top-to-bottom:

```xml
<encodings>
  <text column="[DS].[sum:Sales:qk]"/>
  <text column="[DS].[none:Category:nk]"/>
</encodings>
```

---

## Enabling mark labels

Labels on the text encoding alone are not enough — also enable display via a `<style>` element inside `<pane>`:

```xml
<style>
  <style-rule element="mark">
    <format attr="mark-labels-show" value="true"/>
    <format attr="mark-labels-cull" value="true"/>
  </style-rule>
</style>
```

`mark-labels-cull: "true"` suppresses overlapping labels.

---

## `mark-labels-mode` values

Controls which marks get a label when `mark-labels-show="true"`:

| Value | Behavior |
|---|---|
| `"line-ends"` | Labels only at start and end of a line |
| `"most-recent"` | Label at the most-recent mark (rightmost by time) — works on Line marks |
| `"range"` | Label at the min and/or max of a specified field, scoped per-pane or per-table |
| `"always"` | Label all marks (can get very cluttered) |

### `mark-labels-mode="range"` — label at range endpoint per pane

Use this to show a text label at the point where a field reaches its max value within each pane. Best use case: region name at the rightmost time point in each trellis panel.

```xml
<style-rule element="mark">
  <format attr="mark-labels-mode" value="range"/>
  <format attr="mark-labels-show" value="true"/>
  <format attr="mark-labels-cull" value="true"/>
  <format attr="mark-labels-range-min" value="false"/>      <!-- omit min label -->
  <format attr="mark-labels-range-scope" value="pane"/>     <!-- per panel (not global table) -->
  <format attr="mark-labels-range-field" value="[Sample - Superstore].[tmn:Order Date:qk]"/>
</style-rule>
```

- `mark-labels-range-min="false"` — only label at max (not at min endpoint)
- `mark-labels-range-scope="pane"` — compute max per panel; use `"table"` for global max
- `mark-labels-range-field` — the CI that defines the range (typically the time field)
- Requires `<lod>` encodings for both the label field (e.g. Region) and the range field (e.g. Date) in the same pane
- `mark-labels-mode="most-recent"` only works reliably on Line marks; use `"range"` for Circle/scatter

---

## Label styling (`element="datalabel"`)

Label color and font are controlled by a **separate `<style-rule>` with `element="datalabel"`** — sibling to the `element="mark"` rule:

```xml
<style-rule element="datalabel">
  <format attr="color-mode" value="match"/>
</style-rule>
```

| `attr` | Values | Notes |
|---|---|---|
| `color-mode` | `"match"` / `"user"` | `"match"` = inherit mark color; `"user"` = use explicit `color` |
| `color` | hex e.g. `"#000000"` | Used when `color-mode: "user"` |
| `font-size` | `"11"` | Point size |
| `font-weight` | `"bold"` | Bold |
| `font-style` | `"italic"` | Italic |

`element="cell"` controls label position (sibling style-rule):

| `attr` | Values |
|---|---|
| `text-align` | `"center"` / `"left"` / `"right"` |
| `vertical-align` | `"center"` / `"top"` / `"bottom"` |

---

## Mark appearance (border, opacity)

Inside `<style> → <style-rule element="mark">` (direct child of `<pane>`):

```xml
<format attr="has-stroke"        value="true"/>
<format attr="stroke-color"      value="#ffffff"/>
<format attr="mark-transparency" value="111"/>
```

`mark-transparency`: `"0"` = fully opaque; higher = more transparent (observed: `"111"` ≈ 44% on 0–255 scale).

---

## Custom continuous color palette

**Not in pane encodings.** Stored in the **table-level `<style>`** element (sibling of `<panes>`, `<view>`):

```xml
<style>
  <style-rule element="mark">
    <encoding type="custom-interpolated"
              field="[Sample - Superstore].[sum:Profit:qk]"
              attr="color"
              min="-0.5"
              max="0.5">
      <color-palette name="" type="ordered-diverging" custom="true">
        <color>#ff0000</color>
        <color>#d9d9d9</color>
        <color>#000000</color>
      </color-palette>
    </encoding>
  </style-rule>
</style>
```

- `type` on `color-palette`: `"ordered-diverging"` (pos/neg) or `"ordered-sequential"`
- `min`/`max`: optional; omit for automatic range
- 3 color stops sufficient — Tableau interpolates

---

## Mark types (`<pane> → <mark class="...">`)

| Value | Viz type |
|---|---|
| `Bar` | Bar chart |
| `Circle` | Scatter / circle marks |
| `Line` | Line chart |
| `Area` | Area chart |
| `GanttBar` | Gantt chart |
| `Automatic` | Tableau auto-selects |
| `Shape` | Shape marks |
| `Pie` | Pie chart |
| `Square` | Square / filled marks |
| `Text` | Text table / label |
| `Multipolygon` | Filled polygon map |

---

## Gantt chart pattern

Mark type `GanttBar`. Standard layout:
- **Cols**: continuous date (`tdy:` day-trunc) — bar start position
- **Rows**: dimension — one row per category
- **Size encoding**: duration measure — controls bar length
- **Color/LOD encodings**: optional

```xml
<pane>
  <view>
    <breakdown value="auto"/>
  </view>
  <mark class="GanttBar"/>
  <encodings>
    <color column="[DS].[none:ShipStatus:nk]"/>
    <size  column="[DS].[avg:DaysToShip:qk]"/>
    <lod   column="[DS].[none:Order ID:nk]"/>
  </encodings>
</pane>
```

```xml
<rows>[DS].[none:Product Name:nk]</rows>
<cols>[DS].[tdy:Order Date:qk]</cols>
```

---

## Aggregation

Inside the worksheet's `<view>` element:

```xml
<aggregation value="true"/>   <!-- aggregate (default) -->
<aggregation value="false"/>  <!-- one mark per data row -->
```

---

## Natural sort (encoding dimension order)

Controls stacking order on area charts or legend order for a color dimension. A direct child of `<view>`:

```xml
<natural-sort column="[DS].[none:OrderProfitable:nk]" direction="DESC"/>
```

**Does NOT work:** `shelf-sort-v2` with `shelf="color"` — stripped. `view > sort class="computed"` — also stripped for color dims.

---

## Sorting (shelf-sorts — confirmed working)

Sort lives in `<view>` children as `<shelf-sorts>`, **sibling of `<datasource-dependencies>`**:

```xml
<shelf-sorts>
  <shelf-sort-v2
    dimension-to-sort="[DS].[none:Sub-Category:nk]"
    direction="DESC"
    measure-to-sort-by="[DS].[sum:Profit:qk]"
    is-on-innermost-dimension="true"
    shelf="rows"/>
</shelf-sorts>
```

**Does NOT work:** `sort` as child of `column-instance` (stripped). `tabdoc:sort` via MCP consistently fails with `"missing: global-field-name"`.

---

## Filled map (choropleth)

Key requirements:
- `<rows>`/`<cols>` use **generated fields directly** (no CI format): `[DS].[Latitude (generated)]`
- Must include `<mapsources>` element in `<view>`
- Must include `<geometry>` encoding pointing to `[Geometry (generated)]`
- Mark class is `Automatic`
- No lat/lon column defs needed — Tableau generates them

```xml
<view>
  <datasources>
    <datasource name="Sample - Superstore"/>
  </datasources>
  <mapsources>
    <mapsource name="Tableau"/>
  </mapsources>
  <datasource-dependencies datasource="Sample - Superstore">
    <column name="[State/Province]" role="dimension" type="nominal" datatype="string" semantic-role="[State].[Name]"/>
    <column name="[Profit]" role="measure" type="quantitative" datatype="real"/>
    <column-instance name="[none:State/Province:nk]" column="[State/Province]" pivot="key" type="nominal" derivation="None"/>
    <column-instance name="[sum:Profit:qk]" column="[Profit]" pivot="key" type="quantitative" derivation="Sum"/>
  </datasource-dependencies>
  <aggregation value="true"/>
</view>
```

Pane encodings:
```xml
<encodings>
  <geometry column="[DS].[Geometry (generated)]"/>
  <color    column="[DS].[sum:Profit:qk]"/>
  <lod      column="[DS].[none:State/Province:nk]"/>
</encodings>
```

Rows/cols:
```xml
<rows>[DS].[Latitude (generated)]</rows>
<cols>[DS].[Longitude (generated)]</cols>
```

---

## Double-encoding (avoid)

Do not encode the same field on two visual channels (e.g. bar length AND color both showing Sales). This wastes a channel. Use the second channel to show a *different* measure or dimension — e.g. bar length = Sales, color = Profit Ratio.

---

## Continuous vs discrete date on time-series axes

For line/area charts over time, **continuous date (`:qk`) is almost always better** than discrete (`:ok`):

| | Discrete `:ok` | Continuous `:qk` |
|---|---|---|
| CI suffix | `[tmn:Order Date:ok]` | `[tmn:Order Date:qk]` |
| CI `type` | `"ordinal"` | `"quantitative"` |
| Axis | Category tick per period | True continuous time axis |
| Gaps | None (all periods shown equally) | Shows true time spacing |
| Best for | Ranked/ordinal comparisons | Trends, time series |

Same derivation prefix (`tmn`, `tqr`, `tyr`, etc.) — only suffix and `type` differ. Prefer `:qk` for time series.

---

## When to Use

Use this module when you need to:
- **Add color, size, shape, text, or LOD encodings** to a worksheet's marks card
- **Change the mark type** (Bar, Line, Circle, GanttBar, Pie, Shape, etc.)
- **Configure label display** — enabling mark labels, styling font/color, controlling position
- **Set a custom color palette** (continuous diverging or sequential)
- **Build a Gantt chart** with a size encoding for duration
- **Create a dual-axis chart** with two mark types overlaid
- **Add a filled map (choropleth)** with color encoding over generated lat/lon fields

For filter encodings (which use a different structure), see `workbook-filters.md`.

---

## Best Practices

- **Encodings go in `pane > encodings`, not `pane > view`**: This is the most common structural mistake. Encodings inside `view` are silently stripped on round-trip. Always place `encodings` as a direct child of `pane`, sibling to `view` and `mark`.
- **Declare the field in datasource-dependencies**: Any field used in an encoding must have both a `column` def and a `column-instance` in the worksheet's `datasource-dependencies` — even if it only appears on encodings and not on rows/cols.
- **LOD encodings require their column-instances in the same submission**: LOD encodings and their CIs are co-dependent. Tableau strips both if either is missing. Submit them together.
- **Use `type-v2` for layout, CI format for encodings**: The `column` attr on an encoding node uses CI format `[DS].[none:Field:nk]` — include the datasource prefix.
- **For time-series charts, prefer continuous dates**: Use `[tmn:Order Date:qk]` (`:qk`, type `"quantitative"`) over `[tmn:Order Date:ok]` (`:ok`, type `"ordinal"`) for true continuous time axes that correctly show date spacing.
- **Continuous color palettes go in the table-level `style` node**: Not in pane encodings. The `style` node containing a custom palette is a sibling of `panes` and `view` at the table level.

---

## Common Mistakes

1. **Encoding inside `view`**: `pane > view > mark > encoding` is stripped. Use `pane > encodings > color` (direct child of `pane`).
2. **Missing column def for encoding field**: A field on a color encoding still needs a `column` + `column-instance` in `datasource-dependencies`. Omitting either causes the encoding to appear empty.
3. **Wrong `+` vs `*` syntax in rows/cols for dual-axis**: `*` separates two different fields into separate panes. `+` with the same CI twice creates a dual-axis overlay. Confusing them creates the wrong layout.
4. **Gantt: size encoding controls bar length, not position**: The `size` encoding specifies the duration measure. The bar start position is controlled by the date field on Cols. Both are required for a working Gantt.
5. **Choropleth: using CI format for lat/lon**: The generated lat/lon fields use a different reference format — `[DS].[Latitude (generated)]` (not CI format). Using CI format for these breaks the map.
6. **Natural sort placed inside encodings**: `natural-sort` is a direct child of `view` — not a child of `encodings`. It controls the stacking/legend order for a dimension encoding.

---

## Implementation in Tableau Desktop

The standard workflow for adding an encoding to a worksheet:

1. **Identify the column-instance name** for the field: check the worksheet's `datasource-dependencies` in `get_workbook` output, or derive it using CI naming rules (`none:FieldName:nk` for dimensions, `sum:FieldName:qk` for measures).
2. **Ensure the field has a column def + CI in datasource-dependencies**: add `column` and `column-instance` nodes if they are not already present.
3. **Add the encoding node to `pane > encodings`**: e.g. `{ "type": "color", "attrs": { "column": "[DS].[none:Category:nk]" } }`. Create the `encodings` node if it doesn't exist (as a direct child of `pane`, sibling to `view` and `mark`).
4. **For mark labels**: also add a `style > style-rule[element=mark]` node to `pane` with `mark-labels-show: "true"`.
5. **Submit via `try_set_workbook`** and inspect the result with `get_workbook` to confirm encodings survived round-trip. If an encoding is missing, check that it was in `pane > encodings` (not `pane > view`).

For color palettes: set them in the table-level `style` node (sibling of `panes`), not in pane-level encodings. Use the `encoding` child with `type="custom-interpolated"` and a `color-palette` grandchild.

---

## Discovery method

When you need to learn an unknown encoding format: ask the user to apply it manually in Tableau, then call `tableau-get-workbook` and inspect the cached XML file. Open the XML and look inside the `<pane>` → `<encodings>` element. This is faster and more reliable than guessing.

---

## Dual-axis charts

Dual-axis overlays two mark types on the same axis (e.g., Line + Circle for bump charts). All patterns below discovered by reverse-engineering.

**Rows syntax** — `+` (not `*`) with the same CI referenced twice:
```xml
<rows>([DS].[usr:Calc:qk] + [DS].[usr:Calc:qk])</rows>
```

**Three panes** are created (not two). The second measure's axis uses `y-axis-name`, its second layer adds `y-index="1"`:
```xml
<pane id="1"/>                                                         <!-- base axis — first mark type (e.g. Circle) -->
<pane id="2" y-axis-name="[DS].[usr:Calc:qk]"/>                      <!-- dual axis — second mark type (e.g. Line) -->
<pane id="3" y-axis-name="[DS].[usr:Calc:qk]" y-index="1"/>         <!-- dual axis second layer -->
```

**Axis reversal** (e.g. rank 1 at top) — use `<encoding>` elements in `<style> <style-rule element="axis">` on the table:
```xml
<style-rule element="axis">
  <encoding fold="true" reverse="true" type="space"
    field="[DS].[usr:Calc:qk]" scope="rows" attr="space" class="1" field-type="quantitative"/>
  <encoding reverse="true" type="space"
    field="[DS].[usr:Calc:qk]" scope="rows" attr="space" class="0" field-type="quantitative"/>
</style-rule>
```

**Line-ends labels** (labels only at start/end, not every point):
```xml
<format attr="mark-labels-mode" value="line-ends"/>
```
Set alongside `mark-labels-show="true"` and `mark-labels-cull="false"` in the pane's style-rule.

**`+` vs `*` in rows/cols:**
- `*` = multiple different fields → separate panes side-by-side
- `+` = same field twice → dual-axis overlay on a single axis

---

## Multiple encoding instances of same type

A single pane can have **multiple elements of the same encoding type** — this is valid and confirmed working. Common use case: multiple LOD fields, multiple tooltip fields in one pane.

```xml
<encodings>
  <lod     column="[DS].[none:Field1:nk]"/>
  <lod     column="[DS].[none:Field2:nk]"/>
  <lod     column="[DS].[none:Field3:nk]"/>
  <tooltip column="[DS].[sum:Measure1:qk]"/>
  <tooltip column="[DS].[sum:Measure2:qk]"/>
</encodings>
```

Each referenced field still needs a column def + column-instance in `<datasource-dependencies>`.

---

## Simple reference line (`refline`)

A `<refline>` element lives inside `<view>` (sibling of `<datasource-dependencies>`), distinct from the statistical `<reference-line>` element:

```xml
<refline
  id="refline0"
  axis-column="[DS].[sum:Measure:qk]"
  scope="per-table"
  value-column="[DS].[sum:Measure:qk]"
  label-type="none"/>
```

- `id`: sequential `refline0`, `refline1`, etc.
- `axis-column`: the axis the line appears on
- `value-column`: the measure used to compute the line value (can equal `axis-column`, or a different measure for a fixed-value reference)
- `scope`: `"per-table"` applies across the whole table
- `label-type`: `"none"` = no label shown
- Can target table-calc derived measures (e.g. `[pcto:ctd:Track Name:qk]`)

---

## When to Use

Use this module when you need to:

- Map a field to a **visual channel** (color, size, text/label, shape, LOD/detail, tooltip)
- Set a **mark type** (Bar, Line, Circle, Area, GanttBar, Text, Pie, etc.)
- Configure **label display** (show/hide labels, label mode, label font and color)
- Apply a **custom continuous color palette** (diverging or sequential)
- Build a **Gantt chart**, **filled map**, or **dual-axis** chart
- Control **aggregation** (aggregate vs. one mark per row)
- Add a **natural sort** for stacking order on area or stacked bar charts
- Learn what to do when an encoding pattern is unknown (ask user to apply manually, then inspect with `tableau-get-workbook`)

---

## Best Practices

- **Encodings go inside `pane > encodings`, never inside `pane > view`**: Encodings placed inside `view` are stripped on round-trip.
- **Always declare column defs + column-instances in `datasource-dependencies`**: Every field referenced in an encoding must have both a `column` def and a `column-instance` in the worksheet's `datasource-dependencies`.
- **LOD encodings and their column-instances are co-dependent**: Submit them together in the same `tableau-apply-workbook` call — Tableau strips both if either is missing.
- **Custom color palettes go in the table-level `style`**, not in pane encodings.
- **Use `:qk` (continuous) for time-series axes**: Continuous date column-instances produce a true time axis. Discrete (`:ok`) creates category ticks.
- **Ask the user to apply unknown encodings manually**, then inspect with `tableau-get-workbook` — this is faster than guessing.
- **Prefer `mark-labels-mode="range"` over `"most-recent"` for scatter/circle marks**: `"most-recent"` only works reliably on Line marks.

---

## Common Mistakes

1. **Encoding inside `pane > view`**: `pane > view` is for breakdown and datasource references. Encodings (color, size, text, lod) must be inside `pane > encodings` — placing them in `view` causes them to be silently stripped.
2. **Missing column def or column-instance for an encoded field**: If either the `column` def or the `column-instance` is absent from `datasource-dependencies`, Tableau strips the encoding on round-trip.
3. **Omitting `mark-labels-show="true"` when adding a text encoding**: Adding a `<text>` encoding alone does not display labels. The `style-rule element="mark"` with `mark-labels-show="true"` is also required.
4. **Putting the custom color palette inside `pane > encodings`**: The `encoding type="custom-interpolated"` block goes in the table-level `<style>` element (sibling of `<panes>`), not inside a pane's `<encodings>`.
5. **Using `*` instead of `+` for dual-axis**: `*` creates side-by-side panes; `+` with the same CI twice creates a dual-axis overlay.
6. **Using `mark-labels-mode="most-recent"` on Circle marks**: This mode only works reliably on Line marks. Use `"range"` with `mark-labels-range-scope="pane"` for scatter/circle small multiples.

---

## Implementation

To add a color encoding to an existing worksheet:

1. Call `tableau-get-workbook` to get the current cached XML file path.
2. Parse the XML with `xml.etree.ElementTree`.
3. Find the target worksheet and navigate to its `<pane>` element inside `<table> > <panes>`.
4. Add the column def and column-instance for the color field to the worksheet's `datasource-dependencies` (inside `view`).
5. Find or create the `<encodings>` element inside `<pane>` and append: `<color column="[DS].[none:Category:nk]"/>`.
6. Write to `/tmp/modified_workbook.xml` and submit via `tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })`.
7. Call `tableau-get-workbook` and inspect the result to confirm the encoding survived the round-trip.
