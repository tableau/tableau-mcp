# Workbook XML: Worksheets and Windows

Confirmed patterns for creating worksheets programmatically, window entries, row height, and sheet hiding. All patterns validated via `tableau-get-workbook` observation.

---

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, troubleshoot
- In-scope reason: Worksheets require correct table structure, window entries, datasource-dependencies placement, and incremental-add workflow to avoid silent sheet loss or metadata stripping.
- Out-of-scope risk: none
- Tags: worksheet, window, view, datasource-dependencies, panes, rows, cols, column-instance, table-calc, trellis, small-multiples, index-partition, round-trip, hidden-worksheet, table-structure
- Relevant user prompts/search terms: "how do I create a new worksheet from scratch", "window entry required for worksheets", "sheet disappeared after submission", "worksheets silently dropped without window", "add sheets incrementally one at a time", "trellis small multiples INDEX partition calc", "partition calcs must be role measure type quantitative", "hide a worksheet used in dashboard", "delete worksheet via API", "table-calc ordering-type Field vs Rows", "add field to shelf without template", "manual worksheet build"

## Complete worksheet structure

A minimal but complete worksheet Tableau accepts:

```xml
<worksheet name="My Sheet">
  <table>
    <view>
      <datasources>
        <datasource name="Sample - Superstore" />
      </datasources>
      <datasource-dependencies datasource="Sample - Superstore">
        <column name="[Sub-Category]" role="dimension" type="nominal" datatype="string" />
        <column name="[Profit]" role="measure" type="quantitative" datatype="real" />
        <column-instance name="[none:Sub-Category:nk]" column="[Sub-Category]"
                         pivot="key" type="nominal" derivation="None" />
        <column-instance name="[sum:Profit:qk]" column="[Profit]"
                         pivot="key" type="quantitative" derivation="Sum" />
      </datasource-dependencies>
      <aggregation value="true" />
    </view>
    <style />
    <panes>
      <pane selection-relaxation-option="selection-relaxation-allow">
        <view>
          <breakdown value="auto" />
        </view>
        <mark class="Bar" />
        <encodings>
          <color column="[Sample - Superstore].[none:Category:nk]" />
        </encodings>
      </pane>
    </panes>
    <rows>[Sample - Superstore].[none:Sub-Category:nk]</rows>
    <cols>[Sample - Superstore].[sum:Profit:qk]</cols>
  </table>
  <simple-id uuid="{GENERATE-UUID-HERE}" />
</worksheet>
```

### Critical gotchas

**Column defs and column-instances belong in `datasource-dependencies`**, NOT as children of the `datasource` node inside `datasources`. Putting them inside `datasources/datasource` causes them to be silently stripped on load.

**Both `datasources` AND `datasource-dependencies` are required in `view`**: Omitting `datasources` causes all field references to be stripped — the sheet loads blank. Correct order inside `view`: `datasources` → `datasource-dependencies` → `aggregation`.

**Window entry is REQUIRED**: Submitting a worksheet without a matching `window` entry causes it to be silently dropped by Tableau — the sheet will not appear at all. Always submit worksheet + window together in the same `tableau-apply-workbook` call.

**Add sheets incrementally**: When adding multiple new worksheets, submit and verify each sheet one at a time rather than all at once. After each `tableau-apply-workbook` (even if it times out), use worksheet-list readback to confirm the sheet loaded before proceeding to the next.

**Always use the latest workbook file**: Call `tableau-get-workbook` immediately before any modification to get the current cached XML file path. Never re-use a path from earlier in the session — prior `tableau-apply-workbook` calls update the in-memory workbook state, and using a stale file will silently discard all intermediate changes (e.g. losing filters added in a previous step).

---

## Window entry for worksheets

```xml
<window name="My Sheet" class="worksheet">
  <cards>
    <edge name="left">
      <strip size="160">
        <card type="pages" />
        <card type="filters" />
        <card type="marks" />
      </strip>
    </edge>
    <edge name="top">
      <strip size="2147483647">
        <card type="columns" />
      </strip>
      <strip size="2147483647">
        <card type="rows" />
      </strip>
      <strip size="31">
        <card type="title" />
      </strip>
    </edge>
  </cards>
  <simple-id uuid="{GENERATE-UUID-HERE}" />
</window>
```

---

## Worksheet row/cell height

To set row height (equivalent to dragging in Tableau), add `style-rule[element=cell]` inside the **table-level `style`** node (sibling of `panes`, `view`):

```xml
<style>
  <style-rule element="cell">
    <format attr="height" value="207" />
  </style-rule>
</style>
```

`value` is in pixels as a string. Omit this node to let Tableau auto-size.

---

## Hiding worksheets

Add `hidden="true"` to the **window** node (NOT the worksheet node itself):

```xml
<window name="Category Sales Over Time" class="worksheet" hidden="true">
  ...
</window>
```

Key points:
- Only worksheets used in at least one dashboard can be hidden — standalone worksheets cannot
- Dashboard windows (class `"dashboard"`) are not hidden this way
- A hidden worksheet remains fully functional inside dashboards

---

## Deleting worksheets

**`tableau-apply-workbook` can only ADD or UPDATE sheets. It cannot delete them by omission.** Use `tableau-delete-worksheet` for deletion.

Tableau merges new content with existing internal state. Any sheet already in Tableau's memory persists even if omitted from the submitted XML.

`tableau-delete-worksheet` calls Tableau's native `tabdoc:delete-sheet` command. If it fails, do not try to delete by submitting workbook XML without the worksheet; use Tableau Undo (`Cmd+Z`), File → Revert to Saved, or manually editing the saved `.twb` XML file.

**Prevention:**
- Dashboard creation can take >30 seconds and trigger a timeout error. Check workbook structure after a timeout — the dashboard may have been applied successfully despite the error
- If `tableau-apply-workbook` times out on dashboard creation, do NOT retry immediately. Check sheet list first

---

## Adding worksheets to the workbook root (Python / ElementTree)

Always navigate by tag, not by index — `mapsources` may be absent on workbooks without maps:

```python
import xml.etree.ElementTree as ET

tree = ET.parse("/path/to/cache/workbook-XXXX.xml")
root = tree.getroot()  # <workbook>

worksheets_node = root.find(".//worksheets")
dashboards_node = root.find(".//dashboards")
windows_node    = root.find(".//windows")

worksheets_node.append(new_worksheet_elem)
windows_node.append(new_window_elem)

tree.write("/tmp/modified_workbook.xml", xml_declaration=True, encoding="utf-8")
# Then call: tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })
```

**Workflow:**
1. Call `tableau-get-workbook` — returns `{ filePath, fileUrl }` pointing to a cached XML file
2. Read and parse the XML with ElementTree
3. Modify the element tree
4. Write to `/tmp/modified_workbook.xml`
5. Call `tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })`

**Dashboards go in the `dashboards` node, NOT the `worksheets` node.** Adding a dashboard element to `worksheets` causes Tableau to crash immediately on load.

---

## Trellis / Small-Multiples chart

A trellis creates an N×M grid of panels from a dimension using INDEX()-based table calcs. Confirmed working 2×2 trellis for 4 Regions (Sales vs Profit scatter with time-color and region label per panel).

### Critical rules

1. **Partition calcs must be `role="measure"` `type="quantitative"`** — NOT `role="dimension"` `type="ordinal"`. If declared as dimension, Tableau renders them as `AGG()` on the shelf and collapses all data into a single panel.
2. **`<table-calc>` goes inside `<calculation>`** (as a child element), not directly on `<column>`.
3. **CI `table-calc` uses `level-address`** (with fully-qualified datasource prefix), `ordering-type="Field"`, and **`<order>` children** listing both the partition field and the path/time field. Using `ordering-field` alone (without `<order>` children) does not work.
4. **CI `type="ordinal"` with `:ok:N` suffix** — the `:N` number varies per calc; Tableau assigns it. Let Tableau assign it; don't guess.
5. **No spaces around `*` in shelf syntax**: `([usr:Calc:ok:N]*[sum:Profit:qk])`.
6. **`unnamed="SheetName"` attribute** on the column marks it as worksheet-scoped.

### Column definition (partition calc)

```xml
<column caption="INT((INDEX()-1)/2)" datatype="integer"
        name="[Calculation_4006329602715651]"
        role="measure" type="quantitative"
        unnamed="Regional Profit Paths 2x2">
  <calculation class="tableau" formula="INT((INDEX()-1)/2)">
    <table-calc ordering-type="Rows"/>
  </calculation>
</column>

<column caption="INDEX()%2" datatype="integer"
        name="[Calculation_4006329602584578]"
        role="measure" type="quantitative"
        unnamed="Regional Profit Paths 2x2">
  <calculation class="tableau" formula="INDEX()%2">
    <table-calc ordering-type="Rows"/>
  </calculation>
</column>
```

### Column-instance definition (the critical part)

```xml
<column-instance column="[Calculation_4006329602715651]"
                 derivation="User" name="[usr:Calculation_4006329602715651:ok:3]"
                 pivot="key" type="ordinal">
  <table-calc level-address="[Sample - Superstore].[Region]" ordering-type="Field">
    <order field="[Sample - Superstore].[Region]"/>
    <order field="[Sample - Superstore].[tmn:Order Date:qk]"/>
  </table-calc>
</column-instance>

<column-instance column="[Calculation_4006329602584578]"
                 derivation="User" name="[usr:Calculation_4006329602584578:ok:4]"
                 pivot="key" type="ordinal">
  <table-calc level-address="[Sample - Superstore].[Region]" ordering-type="Field">
    <order field="[Sample - Superstore].[Region]"/>
    <order field="[Sample - Superstore].[tmn:Order Date:qk]"/>
  </table-calc>
</column-instance>
```

### Shelves

```xml
<rows>([Sample - Superstore].[usr:Calculation_4006329602715651:ok:3]*[Sample - Superstore].[sum:Profit:qk])</rows>
<cols>([Sample - Superstore].[usr:Calculation_4006329602584578:ok:4]*[Sample - Superstore].[sum:Sales:qk])</cols>
```

### Encodings for region label at range-max per panel

```xml
<encodings>
  <color column="[Sample - Superstore].[tmn:Order Date:qk]"/>
  <text column="[Sample - Superstore].[none:Region:nk]"/>
  <lod column="[Sample - Superstore].[tmn:Order Date:qk]"/>
  <lod column="[Sample - Superstore].[none:Region:nk]"/>
</encodings>
<style>
  <style-rule element="mark">
    <format attr="mark-labels-mode" value="range"/>
    <format attr="mark-labels-show" value="true"/>
    <format attr="mark-labels-cull" value="true"/>
    <format attr="mark-labels-range-min" value="false"/>
    <format attr="mark-labels-range-scope" value="pane"/>
    <format attr="mark-labels-range-field" value="[Sample - Superstore].[tmn:Order Date:qk]"/>
  </style-rule>
</style>
```

`mark-labels-mode="range"` with `mark-labels-range-scope="pane"` shows the region name only at the point where the time field reaches its max within each panel — clean and uncluttered.

### Style (table-level)

```xml
<style-rule element="label">
  <!-- hides the 0/1 axis tick numbers for the partition calc fields -->
  <format attr="display" field="[Sample - Superstore].[usr:Calculation_...:ok:3]" value="false"/>
  <format attr="display" field="[Sample - Superstore].[usr:Calculation_...:ok:4]" value="false"/>
</style-rule>
<style-rule element="worksheet">
  <format attr="display-field-labels" scope="cols" value="false"/>
</style-rule>
<style-rule element="gridline">
  <format attr="line-visibility" value="off"/>
</style-rule>
<style-rule element="table-div">
  <format attr="stroke-color" scope="cols" value="#d0d0d0"/>
</style-rule>
```

### What does NOT work

- `role="dimension"` `type="ordinal"` on partition columns → Tableau renders as `AGG()` on shelf, one panel only
- `ordering-field="[DS].[Region]"` without `<order>` children on the CI → partition doesn't address correctly
- String IF calc partitions (e.g. `IF [Region] = 'East' THEN 'Group A'`) → Tableau normalizes them but they don't partition as expected
- `mark-labels-mode="most-recent"` for scatter/circle marks → does not show labels reliably; use `"range"` instead
- Missing both `lod=Region` and `lod=Date` in encodings → region label at range max won't render

---

## `tableau-list-available-fields` for datasource inspection

Use `tableau-list-available-fields` (with the `workbook_file` param from `tableau-get-workbook`) to enumerate all fields from datasource definitions. This replaces the old `get_connected_datasources` tool.

The old `get_connected_datasources` had a known limitation — it only exposed datasources connected to dashboard worksheets via the Extensions API, missing standalone worksheets. `tableau-list-available-fields` reads directly from the workbook XML and is more reliable.

---

## Round-trip rules: what survives `tableau-apply-workbook`

> **Note:** The "stripped" list below was observed with the old `loadMetadataFromXml` extension approach. The new Agent API (`tableau-apply-workbook`) uses a different endpoint and may have different round-trip behavior. The **structural rules** (window entry required, node ordering, etc.) still apply. Verify specific structures against real workbook output when in doubt.

### Preserved (confirmed with old extension approach; likely still applies)
- Datasource `column` nodes (calculated fields)
- `datasource-dependencies` (column + column-instance nodes)
- `pane > mark` (class attribute — mark type)
- **`pane > encodings > color/text/size/shape/lod/tooltip`** — pane-level encodings
- `rows` / `cols` content
- `table-calc` children inside column-instances in `datasource-dependencies`
- `view > sort` and `view > computed-sort`
- `view > filter` with `context="true"` (context filters)
- Categorical filters (`function="union"` + `function="member"`)

### Stripped silently (observed with old extension approach; verify with Agent API)
- **Mark-level encodings** (`pane > view > mark > encoding`) — use `pane > encodings` instead
- **Worksheet-level `table-calculations` section** — put table-calc config in column-instance children
- **Sort nodes inside column definitions** in datasource-dependencies — use view-level sort
- **`shelf-sort-deltas`** at the table level
- **Top N filters authored as a FLAT `function="filter"` groupfilter** — stripped. Two working forms exist: the confirmed NESTED recipe (`function="end"` → `order` → `level-members` + matching `<slices>` entry — see `tactics/viz/filters.md`, Top N section), or a table calc filter (INDEX() on Rows + quantitative range filter; see `workbook-calcs` for the per-partition pattern). Preflight rule `malformed-top-n-filter` blocks the flat shape.

### Table calculation config (Compute Using)

Table calcs need a `table-calc` child inside the **column-instance** in `datasource-dependencies`. The column-instance name uses a `:N` suffix (`:1`, `:2`, `:4` — varies, don't assume) and `usr:` derivation prefix:

```xml
<column-instance name="[usr:Calculation_20260306190005:qk:2]"
                 column="[Calculation_20260306190005]"
                 pivot="key" type="quantitative" derivation="User">
  <table-calc ordering-type="Field"
              ordering-field="[DatasourceName].[Sub-Category]" />
</column-instance>
```

`ordering-type` values:
- `"Rows"` → Compute Using: Table (Down)
- `"Field"` + `ordering-field` → Compute Using: specific field
- `"Field"` + `level-address` → Specific Dimensions mode ("At the level"): `"[Sample - Superstore].[none:Sub-Category:nk]"`

---

## When to Use

Use this module when you need to:

- **Create a new worksheet** from scratch or by cloning an existing one
- Understand the **required worksheet XML structure** (`view`, `datasource-dependencies`, `panes`, `rows`/`cols`)
- Add or configure a **window entry** for a worksheet
- **Hide a worksheet** that is used in a dashboard but shouldn't appear as a tab
- Understand **what can and cannot be deleted** via the API
- Build a **trellis / small-multiples** chart using INDEX()-based partition calcs
- Inspect datasource fields with **`tableau-list-available-fields`**
- Understand **round-trip behavior** — which XML nodes survive `tableau-apply-workbook` and which are stripped

---

## Best Practices

- **Always submit worksheet + window together**: Submitting a `<worksheet>` without a matching `<window>` causes the sheet to be silently dropped by Tableau.
- **Add sheets incrementally**: Submit and verify each sheet with worksheet-list readback before adding the next. After a `tableau-apply-workbook` timeout, check first — the sheet may have loaded despite the error.
- **Always call `tableau-get-workbook` immediately before modifying**: Never reuse a cached file path from earlier in the session. Prior `tableau-apply-workbook` calls update the in-memory workbook state.
- **Put column defs and column-instances in `datasource-dependencies`**, not inside the `datasources/datasource` node inside `view`. Putting them in the wrong place causes them to be silently stripped.
- **Both `datasources` AND `datasource-dependencies` are required in `view`**: Omitting `datasources` causes all field references to be stripped — the sheet loads blank.
- **Trellis partition calcs must be `role="measure"` `type="quantitative"`**: Declaring them as `role="dimension"` causes Tableau to render them as `AGG()` and collapse all panels into one.

---

## Common Mistakes

1. **Column defs in the wrong place**: Putting `column` and `column-instance` nodes inside `view > datasources > datasource` instead of inside `view > datasource-dependencies`. These must be in `datasource-dependencies`.
2. **Omitting the window entry**: This is the most common cause of "sheet disappeared after submission." The `<window>` node in `<windows>` is required — without it, the worksheet is silently dropped.
3. **Using a stale cached file path**: Each `tableau-apply-workbook` updates the in-memory workbook. Always call `tableau-get-workbook` to get the fresh path before the next modification. Using a stale path silently discards all intermediate changes.
4. **Attempting to delete sheets via API**: `tableau-apply-workbook` merges new content with existing state — it cannot delete sheets. Sheets present in Tableau's memory persist even if omitted from the submitted XML. Use Undo (`Cmd+Z`) or File → Revert to Saved to recover.
5. **Wrong `table-calc` placement**: The `table-calc` node goes inside the **column-instance** in `datasource-dependencies` — not inside the column def's `calculation` child (unless it's an INDEX() calc configured at the column level).
6. **Hiding a standalone worksheet**: Only worksheets used in at least one dashboard can be hidden via `hidden="true"` on the window node. Trying to hide a standalone worksheet has no effect.

---

## Implementation

To create a complete new worksheet:

1. **Get the current workbook**: Call `tableau-get-workbook` for the current cached XML path and to understand what datasources exist.
2. **Identify the datasource ID**: Use `tableau-list-available-fields` to get the datasource name (`federated.XXXX`) and enumerate available fields.
3. **Build the `<worksheet>` element**: Include `table > view > datasources` (reference datasource by ID) + `datasource-dependencies` (column defs + CIs for all fields used) + `aggregation`. Add `panes > pane > mark` for mark type and `pane > encodings` for visual channels. Add `rows` and `cols` content.
4. **Build the `<window>` element**: Use the same `name` as the worksheet. Include `simple-id` with a freshly generated UUID.
5. **Append both nodes**: add worksheet to `<worksheets>` and window to `<windows>`.
6. **Submit**: Write to `/tmp/modified_workbook.xml` and call `tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })`.
7. **Verify**: Use worksheet-list readback — the new sheet should appear in the tab list.

For table calculations: after the sheet loads, manually configure Compute Using in Tableau's UI, then call `tableau-get-workbook` to capture the exact CI name with the correct `:N` suffix. Use that as the authoritative template for subsequent API calls.

## Source and Confidence

- Source/evidence type: field-tested
- Source: Worksheet/window/table-structure XML incl. trellis INDEX partition patterns; provenance not fully attested post-IA-migration
- Customer-identifying details removed: yes
- Confidence: needs review
- Last reviewed: 2026-07-02
