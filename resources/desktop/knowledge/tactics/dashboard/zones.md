# Workbook XML: Dashboards, Zone Layout, and Actions

Confirmed patterns for dashboard zone structure, device layouts, navigation buttons, zone resizing, dashboard actions (highlight and filter), and hiding worksheets. All patterns validated via `tableau-get-workbook` observation.

---

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, refine, troubleshoot
- In-scope reason: Provides the exact zone XML structure, devicelayouts rules, and dashboard action syntax Claude needs to programmatically create or edit dashboard layouts via MCP tools.
- Out-of-scope risk: none
- Tags: dashboard, zones, layout, devicelayouts, navigation-buttons, dashboard-actions, filter-zones, parameter-controls, zone-ids, zone-coordinates, dashboard-xml, zone-style, viewpoints, zone-flattening, window-uuid
- Relevant user prompts/search terms: "dashboard sheets not showing", "zones disappear after apply", "navigation button goto-sheet", "dashboard action tsc:brush", "filter zone renders empty", "parameter control on dashboard", "hard crash metadata loader", "zone coordinates 100000 scale", "devicelayouts required", "zone IDs shared across dashboards", "how do I position sheets on a dashboard", "place worksheets on a dashboard", "add a sheet to a dashboard layout", "arrange dashboard objects"

## ⚠️ Read this before hand-crafting dashboard XML

**Strong recommendation: don't.** Use `tableau-plan-dashboard-creation` → `tableau-batch-create-and-cache-sheets` → `tableau-build-and-apply-dashboard` (the fast path), or `tableau-batch-create-and-cache-sheets` to allocate the dashboard shell and then push edits via `tableau-apply-dashboard-with-viewpoints`. Hand-crafting dashboard + window XML and injecting via a single `tableau-apply-workbook` call is the path most likely to trigger the metadata loader.

If you must hand-craft anyway, these are the three assertions that actually fire — each one observed in production session logs (`<repositoryDir>/Logs/log.txt`):

1. **`CheckSizeValidity` LogicAssert** — `<size sizing-mode='fixed'>` requires `minwidth == maxwidth` AND `minheight == maxheight`. A range triggers a fatal assert in `DashboardSizePresModelBuilder.cpp:180`. Symptom: `tableau-apply-workbook` returns "Failed to apply workbook XML"; log shows `condition: 'CheckSizeValidity(minWidth, minHeight, maxWidth, maxHeight, sizeMode)'`.

   ```xml
   <!-- WRONG: min != max with fixed sizing -->
   <size sizing-mode='fixed' maxwidth='1400' maxheight='1000' minwidth='1000' minheight='800' />

   <!-- RIGHT: min == max for fixed sizing -->
   <size sizing-mode='fixed' minwidth='1400' maxwidth='1400' minheight='1000' maxheight='1000' />
   ```

2. **`HasVisualDoc` failure** — `<window class='dashboard'><viewpoints>` must contain bare `<viewpoint name='SheetName' />` leaves, NOT nested `<window>` elements. If viewpoints are malformed, the whole workbook load is rejected in `DashboardController_VisualControllers.cpp`.

   ```xml
   <!-- WRONG: nested <window> elements inside <viewpoints> -->
   <window class='dashboard' name='My Dashboard'>
     <viewpoints>
       <window class='worksheet' name='Sheet 1'><cards>...</cards><viewpoint /></window>
     </viewpoints>
   </window>

   <!-- RIGHT: bare viewpoint leaves -->
   <window class='dashboard' name='My Dashboard'>
     <viewpoints>
       <viewpoint name='Sheet 1' />
       <viewpoint name='Sheet 2' />
     </viewpoints>
     <active id='-1' />
   </window>
   ```

3. **Silent zone flattening** — nested `<zone type-v2='layout-flow'>` rows whose children are sheet zones (with `name='...'`) can get silently dropped at apply. `tableau-list-dashboards` still reports success, so the failure is invisible to the agent. Always verify post-apply by re-fetching with `tableau-get-dashboard` and counting zones: if the zone count went down, your layout structure was rejected and you need to restructure (use a flat `layout-basic` parent with absolute coords, OR mimic the reference workbook's `<zone param='horz' type-v2='layout-flow'>` row pattern with explicit per-child coords in 100000-based percentages).

---

## Dashboard node position (critical)

**Dashboards go in the `<dashboards>` element, NOT the `<worksheets>` element.** Adding a dashboard to `<worksheets>` crashes Tableau immediately on load.

Always navigate by element name, not by index:

```python
import xml.etree.ElementTree as ET

tree = ET.parse('cache/workbook-XXXX.xml')
root = tree.getroot()
wb = root  # or root.find('workbook') depending on file structure
dashboards_node = wb.find('dashboards')
windows_node    = wb.find('windows')
dashboards_node.append(new_dashboard_element)
windows_node.append(new_dashboard_window_element)
```

**Dashboard children order:** `<style>` → `<size>` → `<zones>` → `<devicelayouts>` → `<simple-id>`

---

## Zone layout rules

1. **Use `type-v2`**, not `type`, for layout zone types. Tableau normalizes on load.
2. **Flat layout**: sheet zones are direct children of the root `layout-basic` zone using absolute coordinates (0–100000 scale). Do NOT nest layout containers.
3. **Zone IDs** must be unique across the entire workbook. Inspect the existing workbook to find the highest ID in use and increment from there.
4. **Zone coordinates**: margins offset from 0. Typical pattern: x=800, y=1000 for first zone.
5. Each sheet zone needs a `<zone-style>` child with border and margin=4 format nodes.
6. The root `layout-basic` zone needs a `<zone-style>` child (margin=8), placed as the **last child** after all sheet zones.
7. **`<devicelayouts>` is REQUIRED** — omitting it causes sheets to appear invisible.
8. **Dashboard children order**: `<style>` → `<size>` → `<zones>` → `<devicelayouts>` → `<simple-id>`.

---

## Complete dashboard XML (confirmed working)

```xml
<dashboard name="My Dashboard" enable-sort-zone-taborder="true">
  <style/>
  <size minwidth="1000" maxwidth="1000" minheight="800" maxheight="800"/>
  <zones>
    <zone y="0" type-v2="layout-basic" h="100000" w="100000" x="0" id="6">
      <zone y="1000" h="49000" w="98400" x="800" id="5" name="Sheet A">
        <zone-style>
          <format attr="border-color" value="#000000"/>
          <format attr="border-style" value="none"/>
          <format attr="border-width" value="0"/>
          <format attr="margin" value="4"/>
        </zone-style>
      </zone>
      <zone y="50000" h="49000" w="49200" x="800" id="7" name="Sheet B">
        <zone-style>
          <format attr="border-color" value="#000000"/>
          <format attr="border-style" value="none"/>
          <format attr="border-width" value="0"/>
          <format attr="margin" value="4"/>
        </zone-style>
      </zone>
      <zone-style>
        <format attr="border-color" value="#000000"/>
        <format attr="border-style" value="none"/>
        <format attr="border-width" value="0"/>
        <format attr="margin" value="8"/>
      </zone-style>
    </zone>
  </zones>
  <devicelayouts>
    <devicelayout name="Phone" auto-generated="true">
      <size minheight="900" maxheight="900" sizing-mode="vscroll"/>
      <zones>
        <zone y="0" type-v2="layout-basic" h="100000" w="100000" x="0" id="10">
          <zone y="1000" type-v2="layout-flow" h="98000" w="98400" x="800" id="9" param="vert">
            <zone y="1000" h="49000" w="98400" x="800" id="5" name="Sheet A" fixed-size="280" is-fixed="true">
              <zone-style>
                <format attr="border-color" value="#000000"/>
                <format attr="border-style" value="none"/>
                <format attr="border-width" value="0"/>
                <format attr="margin" value="4"/>
                <format attr="padding" value="0"/>
              </zone-style>
            </zone>
          </zone>
          <zone-style>
            <format attr="border-color" value="#000000"/>
            <format attr="border-style" value="none"/>
            <format attr="border-width" value="0"/>
            <format attr="margin" value="8"/>
          </zone-style>
        </zone>
      </zones>
    </devicelayout>
  </devicelayouts>
  <simple-id uuid="{GENERATE-UUID-HERE}"/>
</dashboard>
```

**Zone ID rules:** Sheet zone IDs must match exactly between `<zones>` and `<devicelayouts>`. The `<devicelayouts>` container zones use their own IDs not shared with main `<zones>`.

---

## Dashboard canvas size

```python
size_node = dashboard_element.find('size')
size_node.set('minwidth', '1600')
size_node.set('maxwidth', '1600')
size_node.set('minheight', '900')
size_node.set('maxheight', '900')
```

Common sizes: `1000×800` (default), `1600×900` (widescreen), `1200×800`.

---

## Proportional zone sizing formula

Total usable height: ~98222 units (y=889 to y=99111).

| Layout | Top h | Bottom y | Bottom h |
|---|---|---|---|
| 50% / 50% | 49111 | 50000 | 49111 |
| 25% / 75% | 24556 | 25445 | 73666 |
| 33% / 67% | 32413 | 33302 | 64920 |

Formula: `top_h = round(98222 * pct)`, `bot_y = 889 + top_h`, `bot_h = 98222 - top_h`

---

## Zone resizing — do NOT patch by zone ID

**Zone IDs are shared across dashboards.** Patching by ID will inadvertently update zones in other dashboards.

**Safe approach:** Target zones by dashboard name AND zone name. Better: replace the entire dashboard element with fresh unique IDs.

```python
import xml.etree.ElementTree as ET

# WRONG — modifies zones by ID across all dashboards
for zone in root.iter('zone'):
    if zone.get('id') == '137':
        zone.set('h', '24556')  # Affects OTHER dashboards too!

# RIGHT — target within a specific dashboard by zone name
for dashboard in root.iter('dashboard'):
    if dashboard.get('name') == 'Customers':
        for zone in dashboard.iter('zone'):
            if zone.get('name') == 'Customer Overview':
                zone.set('h', '24556')
```

---

## Dashboard window entry

```xml
<window name="My Dashboard" class="dashboard" maximized="true">
  <viewpoints>
    <viewpoint name="Sheet A">
      <zoom type="entire-view"/>
    </viewpoint>
    <viewpoint name="Sheet B">
      <zoom type="entire-view"/>
    </viewpoint>
  </viewpoints>
  <active id="8"/>
  <simple-id uuid="{GENERATE-UUID-HERE}"/>
</window>
```

Zoom type values: `"entire-view"`, `"fit-width"`, `"fit-height"`, `"none"` (Normal).

---

## Navigation buttons

Navigation buttons are zones with `type-v2="dashboard-object"` placed as **siblings** of the `layout-basic` container (direct children of the root `<zones>` element), NOT inside the layout-basic container:

```xml
<zone x="85875" y="889" w="8875" h="4111" type-v2="dashboard-object" id="249">
  <button button-type="text"
          action="tabdoc:goto-sheet window-id=&quot;{TARGET-DASHBOARD-WINDOW-UUID}&quot;">
    <button-visual-state>
      <caption>Product</caption>
      <button-caption-font-style fontname="Tableau Bold" fontsize="12"/>
      <format attr="background-color" value="#ffffff"/>
      <format attr="border-style" value="dotted"/>
      <format attr="border-width" value="1"/>
      <format attr="border-color" value="#000000"/>
    </button-visual-state>
  </button>
</zone>
```

`action` requires the **window** UUID (from `<windows>` element), NOT the dashboard's own `<simple-id>` UUID.

---

## Dashboard actions

Actions live in a **top-level `<actions>` element** in the workbook (sibling to `<worksheets>`, `<dashboards>`) — NOT inside the dashboard element itself.

The `<actions>` element is a direct child of the workbook root. If one already exists, append to it; do not create a duplicate.

### Highlight action (`tsc:brush`)

```xml
<action name="[Action1_A3F9F03BE528430FB01C001E7EF5FA14]" caption="Highlight1">
  <activation type="on-hover" auto-clear="true"/>
  <source type="sheet" dashboard="Customers">
    <exclude-sheet name="Customer Overview"/>
  </source>
  <command command="tsc:brush">
    <param name="exclude" value="Customer Overview"/>
    <param name="field-captions" value="Customer Name"/>
    <param name="target" value="Customers"/>
  </command>
</action>
```

- `activation type`: `"on-hover"` or `"on-select"`
- `auto-clear="true"` resets when mouse leaves / selection clears
- **`<exclude-sheet>` excludes a sheet from BOTH triggering AND receiving** — to have all sheets participate, omit excludes entirely
- `field-captions` = field name to match on

### Filter action — All Fields variant (simpler, recommended)

```xml
<action name="[Action1_DE4200E5E5F14FC68D4CEE8CB0439BBB]" caption="State Filter">
  <activation type="on-select" auto-clear="true"/>
  <source type="sheet" worksheet="Midwest Sales by State" dashboard="Midwest Analysis"/>
  <command command="tsc:tsl-filter">
    <param name="exclude" value="Midwest Sales by State"/>
    <param name="special-fields" value="all"/>
    <param name="target" value="Midwest Analysis"/>
  </command>
</action>
```

- `exclude` param prevents the filter from being applied back to the source sheet. Omit to filter all sheets including source.
- No `<datasources>`/`<datasource-dependencies>` needed in the `<actions>` element for this variant.

### Cross-filtering all sheets symmetrically

Omit `exclude` and use `auto-clear="true"`. Add one action per source sheet:

```xml
<action name="[Action2_GUID]" caption="Filter 1 (generated)">
  <activation type="on-select" auto-clear="true"/>
  <source type="sheet" worksheet="Sub-Category" dashboard="Analysis"/>
  <command command="tsc:tsl-filter">
    <param name="special-fields" value="all"/>
    <param name="target" value="Analysis"/>
  </command>
</action>
```

### Filter action — Specific field variant (TSL expression)

For filtering on a specific field only:

```xml
<link caption="Filter1"
      expression="tsl:Customers?%5BSample%20-%20Superstore%5D.%5BRegion%5D~s0=&lt;[Sample - Superstore].[Region]~na&gt;"
      escape="\\"
      multi-select="true"
      url-escape="true"
      delimiter=","/>
```

TSL format (URL-decoded): `tsl:{dashboard}?{DS}.{field}~s0=<{DS}.{field}~na>`

URL-encode: spaces → `%20`, `[` → `%5B`, `]` → `%5D`

Also requires `<datasources>` + `<datasource-dependencies>` siblings inside the `<actions>` element, listing the filtered field.

### Parameter action

Parameter actions use `<edit-parameter-action>`. This element is valid in workbook schema version 18.1+ (Tableau 2026.1) when the workbook is created/applied via MCP `apply-workbook`. However, **injecting it into a TWB extracted from a TWBX may fail validation** if the TWBX was saved with a different internal schema declaration.

**If validation fails** (Error D2E8DA72: "no declaration found for element 'edit-parameter-action'"), create one action via Tableau UI first, then get-workbook to capture the working XML pattern and replicate for remaining actions.

```xml
<edit-parameter-action caption='Set Color by Category' name='[Action5_GUID]'>
  <activation type='on-select' />
  <source dashboard='Dynamic Dimension Coloring' type='sheet' worksheet='Sales by Category' />
  <agg-type type='attr' />
  <clear-option type='do-nothing' value='s:LROOT:Category' />
  <params>
    <param name='source-field' value='[federated.superstore001].[none:Calc_paramCategory:nk]' />
    <param name='target-parameter' value='[Parameters].[Parameter 1]' />
  </params>
</edit-parameter-action>
```

- `source-field`: the field on the source worksheet's Detail (`lod`) shelf whose value is sent
- `target-parameter`: format `[Parameters].[ParameterName]`
- `clear-option value`: `s:LROOT:` + the default value to keep when selection clears
- `agg-type='attr'`: read the unaggregated value from the clicked mark

### Action duplication

Tableau auto-generates per-sheet-pair copies of highlight and parameter actions for dashboards. A workbook with 1 highlight + 4 parameter actions on a 4-sheet dashboard will balloon to ~500+ actions. When editing workbook XML, always replace the entire `<actions>` block with the clean set — Tableau will re-generate the duplicates internally.

---

## Filter zones on dashboards

Filter zones require THREE things to display a filter control:

1. `param` attribute — the fully qualified field reference (e.g., `[federated.cc01].[tmn:Calc_Date:qk]`)
2. `values` attribute — the filter display type (e.g., `"database"`)
3. Dashboard-level `<datasources>` + `<datasource-dependencies>` referencing the filter field

```xml
<dashboard name="MyDash">
  <datasources>
    <datasource caption="My Data" name="federated.ds01"/>
  </datasources>
  <datasource-dependencies datasource="federated.ds01">
    <column caption="Date" datatype="date" name="[Calc_Date]" role="dimension" type="ordinal">
      <calculation class="tableau" formula="DATE([Timestamp])"/>
    </column>
    <column-instance column="[Calc_Date]" derivation="Month-Trunc" name="[tmn:Calc_Date:qk]" pivot="key" type="quantitative"/>
  </datasource-dependencies>
  <zones>
    ...
    <zone id="17" name="Sheet Name" param="[federated.ds01].[tmn:Calc_Date:qk]" type-v2="filter" values="database" ...>
    ...
  </zones>
</dashboard>
```

**Without `param`**, the filter zone renders as empty/invisible. The `param` value must exactly match a `column-instance` name in the dashboard's `datasource-dependencies`.

To constrain filter width, wrap in a horizontal `layout-flow` container with an `empty` spacer zone:

```xml
<zone param="horz" type-v2="layout-flow">
  <zone fixed-size="792" is-fixed="true" type-v2="empty"/>
  <zone name="Sheet" param="[ds].[field:ref]" type-v2="filter" values="database"/>
</zone>
```

---

## Parameter control zones

**Parameter control zones** use `type-v2="paramctrl"` with NO `name` attribute:

```xml
<zone id="32" mode="compact" param="[Parameters].[Param_Granularity]" type-v2="paramctrl" .../>
```

- `param` = `[Parameters].[ParameterName]` (the parameter datasource reference)
- `mode="compact"` for dropdown style
- Do NOT add `name="worksheet"` — paramctrl zones are datasource-level, not worksheet-level
- Requires dashboard-level `<datasource-dependencies datasource="Parameters">` with the parameter column definition

---

## Axis title renaming and cleanup

To give an axis a clean label (replacing the raw field name):

```xml
<style-rule element="axis">
  <format attr="title" class="0" field="[datasource].[field:ref]" scope="rows" value="Calls"/>
  <format attr="auto-subtitle" class="0" field="[datasource].[field:ref]" scope="rows" value="true"/>
  <format attr="subtitle" class="0" field="[datasource].[field:ref]" scope="rows" value=""/>
</style-rule>
```

- `attr="title"` + `value="Calls"` — sets the axis title text
- `scope="rows"` or `scope="cols"` — which axis
- To HIDE an axis title entirely: `<format attr="title" ... value=""/>` (empty string)
- To HIDE axis display: `<format attr="display" class="0" field="..." scope="rows" value="false"/>`

---

## Hiding field labels

To hide column/row field labels (the field name header above the values):

```xml
<style-rule element="worksheet">
  <format attr="display-field-labels" scope="cols" value="false"/>
</style-rule>
```

- `scope="cols"` hides column field labels; `scope="rows"` hides row field labels
- Must be inside `<style-rule element="worksheet">`, NOT `element="table"`
- Goes in the table-level `<style>` block (sibling of `<panes>`)

---

## Shelf changes — MCP tools vs direct XML

**Modifying** an existing worksheet's `<rows>`/`<cols>` via direct XML edit causes `apply-worksheet` to fail. Use MCP tools (`add-field-to-cols/rows`) for incremental changes.

**However**, writing a COMPLETE worksheet XML (replacing the entire worksheet content) with direct `<rows>`/`<cols>` DOES work — even with complex nesting like `(dim / (KPI1 / KPI2 / ...)) * (measure1 + measure2)`. The key is writing the full worksheet, not editing just the shelf lines.

---

## Saving workbooks

**Check whether the workbook has a file path before saving:**

```powershell
# Returns True if workbook is unsaved (no file path)
(Get-Process tableau).MainWindowTitle -match 'Book\d+'
```

- Window title contains `"BookN"` → **unsaved** (created via `apply-workbook`). `tabdoc:save` will silently fail with internal error 6EA18A9E. Use `tabdoc:save-as` instead.
- Window title contains an actual filename → **has file path**. `tabdoc:save` works.

**TWBX repackaging** (reliable for any workbook state):
1. Get workbook XML via `get-workbook`
2. Clean auto-duplicated actions
3. Write TWB to a temp working directory (e.g. `$env:TEMP/tableau-mcp-twbx-extract/` on Windows, `/tmp/tableau-mcp-twbx-extract/` on Unix) — **do NOT write to a project-relative path**, it pollutes the working tree
4. Update TWBX zip entry via PowerShell `System.IO.Compression.ZipFile`

---

## Dashboard XML via API — hard crash warning

Submitting a dashboard element via `tableau-apply-workbook` can cause a **hard crash** in Tableau's `load-underlying-metadata`. When this happens, the workbook is left completely empty (all worksheets wiped). The apply history snapshots cannot protect against this — the crash prevents a post-apply snapshot from being saved. Use `tabdoc:undo` immediately if this occurs.

**This is not a soft error.** There is no recovery once it occurs.

**Safe approach:**
1. Build and verify all worksheets via API first
2. Have the user create the dashboard manually in Tableau (drag sheets in)
3. Inspect the result with `tableau-get-workbook` to capture the exact working XML
4. Use that native-authored XML as a template for future dashboard creation

**If you must attempt dashboard XML via API:** work on a separate workbook copy so that sheets are not at risk.

---

## When to Use

Use this module when you need to:

- **Create a new dashboard** and lay out worksheet zones on the canvas
- **Resize or reposition zones** within an existing dashboard
- **Add navigation buttons** between dashboards
- **Add dashboard actions** (highlight, filter, or parameter actions triggered by user interaction)
- **Add filter zones or parameter controls** to a dashboard
- **Rename or hide axis titles** and field labels
- **Save workbooks** programmatically (detect file path state first)
- **Hide worksheets** that are used in dashboards but shouldn't appear as tabs
- Understand the **dashboard XML structure** (zones, devicelayouts, window entries)

---

## Best Practices

- **Always include `devicelayouts`**: Omitting the `devicelayouts` node causes all sheets to appear invisible on the dashboard. It is required even if you don't care about phone layouts.
- **Use unique zone IDs**: Zone IDs must be unique across the entire workbook. Find the max existing ID with `tableau-get-workbook` and increment from there.
- **Match zone IDs between `zones` and `devicelayouts`**: Sheet zone IDs must be identical in both the main `zones` block and the `devicelayouts/zones` block.
- **Target zones by name, not by ID**: IDs are shared across dashboards — patching by ID modifies zones in other dashboards. Always scope modifications to a specific dashboard name.
- **Add actions to the top-level `actions` node**: Dashboard actions are siblings of `worksheets`/`dashboards` at the workbook root — not inside the dashboard node itself.
- **Use `type-v2` not `type` for layout zone types**: Tableau normalizes on load and expects `type-v2`.
- **Test after dashboard API submission**: Dashboard creation can cause hard crashes in Tableau's metadata loader. Always verify with `tableau-list-worksheets` immediately after submission.

---

## Common Mistakes

1. **Adding dashboard to `worksheets` node**: Dashboards belong in the `dashboards` node. Adding a dashboard element to `worksheets` causes Tableau to crash immediately on load.
2. **Omitting `devicelayouts`**: This is the most common cause of "sheets not showing up" in dashboards. Always include at least the auto-generated Phone layout.
3. **Wrong node position for actions**: Dashboard actions placed inside the dashboard node (as children) are ignored. They must be in the top-level `actions` node at the workbook root.
4. **Patching zones by ID across dashboards**: Zone IDs are shared globally — a patch by ID can silently modify zones in a different dashboard than intended.
5. **Wrong `action` target UUID**: Navigation button `action` requires the **window** UUID (from the `windows` node), not the dashboard's `simple-id` UUID.
6. **Missing `zone-style` children**: Each sheet zone and the root layout-basic zone need a `zone-style` child with border/margin format nodes. Missing them causes layout rendering artifacts.

---

## Implementation

The recommended workflow for creating a dashboard via API:

1. **Build and verify all worksheets first**: Use `tableau-apply-workbook` + `tableau-list-worksheets` to confirm all source worksheets load correctly before attempting dashboard creation.
2. **Have the user create the dashboard manually if possible**: Drag sheets into a dashboard in Tableau's UI, then call `tableau-get-workbook` to capture the exact native XML. Use that as a template — it is guaranteed to be valid.
3. **If building the dashboard XML manually**:
   - Assign fresh unique zone IDs (higher than any existing IDs in the workbook)
   - Include `style` → `size` → `zones` → `devicelayouts` → `simple-id` children in that order
   - Generate a new UUID for `simple-id`
   - Use the 0–100000 coordinate scale for zone positions
4. **Submit with `tableau-apply-workbook`** and verify. If a hard crash occurs (workbook wiped), use `tabdoc:undo` immediately — the apply history snapshots cannot help here because the crash prevents the snapshot from being saved.
5. **Verify**: Call `tableau-list-worksheets` to confirm the dashboard appears. If it timed out, check first before retrying — the dashboard may have been applied successfully.

### Preferred: Two-step dashboard creation (confirmed safe)

Direct dashboard XML injection via `tableau-apply-workbook` frequently fails or crashes Tableau. A **two-step approach** using dedicated tools is safer and confirmed working:

1. **Create empty scaffold**: Call `tableau-batch-create-and-cache-sheets` with the dashboard name (and any worksheet names). This creates a minimal dashboard node with correct window pairing and applies the workbook in one step, returning cached file paths.
2. **Populate zones**: Call `tableau-get-dashboard` to get the empty dashboard XML. Edit the cached file to add zone layout (sheet zones inside a `layout-basic` root zone, plus `devicelayouts`). Then call `tableau-apply-dashboard-with-viewpoints` with the modified file and the list of worksheet names.

This avoids the hard crash because `tableau-batch-create-and-cache-sheets` handles the delicate dashboard/window pairing, and `tableau-apply-dashboard-with-viewpoints` handles viewpoint injection separately.

**What does NOT work reliably**: Building the complete dashboard + window XML by hand and injecting via `tableau-apply-workbook` in a single step — this is the path most likely to trigger the metadata loader crash.

## Source and Confidence

- Source/evidence type: field-tested
- Source: Dashboard zone/devicelayouts/action XML observed via tableau-get-workbook; contains confirmed-working snippets, provenance not fully attested post-IA-migration
- Customer-identifying details removed: yes
- Confidence: needs review
- Last reviewed: 2026-07-02
