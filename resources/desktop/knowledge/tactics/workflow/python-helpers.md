# Workbook XML: Python Script Templates

Ready-to-use Python templates for common workbook modification tasks using `xml.etree.ElementTree` (stdlib, no extra dependencies).

All templates:
- Read from the file path returned by `tableau-get-workbook`
- Preserve `connection`, `named-connections`, `document-format-change-manifest`, and the `Parameters` datasource
- Save to `/tmp/modified_workbook.xml` for submission via `tableau-apply-workbook`

---

## Scope Check


- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, format
- In-scope reason: Python templates provide ready-to-use ElementTree scripts for common workbook modifications with correct namespace setup and navigation helpers.
- Out-of-scope risk: none
- Tags: python, xml, elementtree, namespace, workbook-modification, calculated-field, filter, worksheet-creation, datasource, column-instance, template, round-trip, user-namespace
- Relevant user prompts/search terms: "Python script to add a calculated field", "how do I add a worksheet using Python", "ElementTree namespace setup for user attrs", "modify workbook XML with Python", "add a categorical filter via Python script", "duplicate and modify a worksheet programmatically", "inspect datasource fields with Python", "ready-to-use Python templates for Tableau XML", "find_worksheet find_datasource helper functions", "print workbook structure summary"

## Namespace setup (required in every script)

```python
import xml.etree.ElementTree as ET

USER_NS = 'http://www.tableausoftware.com/xml/user'
ET.register_namespace('user', USER_NS)

WORKBOOK_FILE = 'cache/workbook-XXXX.xml'  # path from tableau-get-workbook
OUTPUT_FILE   = '/tmp/modified_workbook.xml'

tree = ET.parse(WORKBOOK_FILE)
root = tree.getroot()
```

Submit after any script:
```
tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })
```

---

## Navigation helpers

```python
import xml.etree.ElementTree as ET

USER_NS = 'http://www.tableausoftware.com/xml/user'
ET.register_namespace('user', USER_NS)

def find_datasource(root, ds_name):
    """Find a datasource element by its name attribute (e.g. 'federated.XXXX')."""
    for ds in root.find('datasources'):
        if ds.get('name') == ds_name:
            return ds
    return None

def find_worksheet(root, sheet_name):
    """Find a worksheet element by its name attribute."""
    for ws in root.find('worksheets'):
        if ws.get('name') == sheet_name:
            return ws
    return None

def find_window(root, sheet_name):
    """Find a window element by its name attribute."""
    for w in root.find('windows'):
        if w.get('name') == sheet_name:
            return w
    return None

def get_view(ws):
    """Return the <view> element inside a worksheet's <table>."""
    return ws.find('table/view')

def get_ds_deps(ws, ds_name):
    """Return the datasource-dependencies element for a given datasource."""
    view = get_view(ws)
    return view.find(f"datasource-dependencies[@datasource='{ds_name}']")

def print_structure(root):
    """Print a summary of datasources, worksheets, dashboards, and windows."""
    print('=== DATASOURCES ===')
    for ds in root.find('datasources'):
        name    = ds.get('name', '')
        caption = ds.get('caption', name)
        cols    = ds.findall('column')
        print(f'  {caption} (name={name}) — {len(cols)} columns')

    print('=== WORKSHEETS ===')
    for ws in root.find('worksheets'):
        print(f'  {ws.get("name", "")}')

    dashboards_el = root.find('dashboards')
    if dashboards_el is not None:
        print('=== DASHBOARDS ===')
        for db in dashboards_el:
            print(f'  {db.get("name", "")}')

    print('=== WINDOWS ===')
    for w in root.find('windows'):
        print(f'  {w.get("name", "")} class={w.get("class", "")}')
```

---

## Inspect datasource fields

List all columns from a datasource with their role and datatype.

```python
import xml.etree.ElementTree as ET

ET.register_namespace('user', 'http://www.tableausoftware.com/xml/user')

WORKBOOK_FILE = 'cache/workbook-XXXX.xml'
DS_NAME       = 'federated.XXXX'  # from tableau-get-workbook or get_connected_datasources

tree = ET.parse(WORKBOOK_FILE)
root = tree.getroot()

ds = root.find(f"datasources/datasource[@name='{DS_NAME}']")
if ds is None:
    print(f'Datasource not found: {DS_NAME}')
else:
    print(f"Fields in '{ds.get('caption', DS_NAME)}':")
    dims     = []
    measures = []
    for col in ds.findall('column'):
        name    = col.get('name', '')
        caption = col.get('caption', name)
        role    = col.get('role', '')
        dtype   = col.get('datatype', '')
        formula = None
        calc    = col.find('calculation')
        if calc is not None:
            formula = calc.get('formula', '')
        entry = f'  {caption} ({dtype})' + (f' = {formula}' if formula else '')
        if role == 'measure':
            measures.append(entry)
        else:
            dims.append(entry)

    print('Dimensions:')
    for d in sorted(dims): print(d)
    print('Measures:')
    for m in sorted(measures): print(m)
```

---

## Add a calculated field

Add a `<column>` with a `<calculation>` child to a datasource. Use a unique name to avoid collisions.

```python
import xml.etree.ElementTree as ET

ET.register_namespace('user', 'http://www.tableausoftware.com/xml/user')

WORKBOOK_FILE = 'cache/workbook-XXXX.xml'
OUTPUT_FILE   = '/tmp/modified_workbook.xml'
DS_NAME       = 'federated.XXXX'

tree = ET.parse(WORKBOOK_FILE)
root = tree.getroot()

ds = root.find(f"datasources/datasource[@name='{DS_NAME}']")

# Quantitative (measure) calculated field
calc_col = ET.SubElement(ds, 'column')
calc_col.set('name',     '[Calculation_20260324_001]')
calc_col.set('caption',  'Revenue per Order')
calc_col.set('role',     'measure')
calc_col.set('type',     'quantitative')
calc_col.set('datatype', 'real')

calc_el = ET.SubElement(calc_col, 'calculation')
calc_el.set('class',   'tableau')
calc_el.set('formula', 'SUM([Sales]) / COUNTD([Order ID])')

# String (dimension) calculated field — note different role/type/datatype
tier_col = ET.SubElement(ds, 'column')
tier_col.set('name',     '[Calculation_20260324_002]')
tier_col.set('caption',  'Profit Tier')
tier_col.set('role',     'dimension')
tier_col.set('type',     'nominal')
tier_col.set('datatype', 'string')

tier_calc = ET.SubElement(tier_col, 'calculation')
tier_calc.set('class',   'tableau')
tier_calc.set('formula', "IF [Profit] > 0 THEN 'Profitable' ELSE 'Unprofitable' END")

tree.write(OUTPUT_FILE, encoding='utf-8', xml_declaration=True)
print(f'Saved to {OUTPUT_FILE}')
# Then: tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })
```

---

## Add a new worksheet

Every new worksheet requires **two additions**: a `<worksheet>` in `<worksheets>` AND a matching `<window>` in `<windows>`. Missing the window entry causes workbook document apply to silently fail.

```python
import xml.etree.ElementTree as ET

ET.register_namespace('user', 'http://www.tableausoftware.com/xml/user')

WORKBOOK_FILE = 'cache/workbook-XXXX.xml'
OUTPUT_FILE   = '/tmp/modified_workbook.xml'
DS_NAME       = 'federated.XXXX'
SHEET_NAME    = 'My New Sheet'

tree = ET.parse(WORKBOOK_FILE)
root = tree.getroot()

# --- Build <worksheet> ---
ws_el = ET.Element('worksheet')
ws_el.set('name', SHEET_NAME)

table_el = ET.SubElement(ws_el, 'table')

# <view> with datasource reference and column-instances
view_el = ET.SubElement(table_el, 'view')

ds_ref_list = ET.SubElement(view_el, 'datasources')
ds_ref = ET.SubElement(ds_ref_list, 'datasource')
ds_ref.set('name', DS_NAME)

ds_deps = ET.SubElement(view_el, 'datasource-dependencies')
ds_deps.set('datasource', DS_NAME)

ci1 = ET.SubElement(ds_deps, 'column-instance')
ci1.set('column',     '[Customer Name]')
ci1.set('derivation', 'None')
ci1.set('name',       '[none:Customer Name:nk]')
ci1.set('pivot',      'key')
ci1.set('type',       'nominal')

ci2 = ET.SubElement(ds_deps, 'column-instance')
ci2.set('column',     '[Sales]')
ci2.set('derivation', 'Sum')
ci2.set('name',       '[sum:Sales:qk]')
ci2.set('pivot',      'key')
ci2.set('type',       'quantitative')

# <panes>
panes_el = ET.SubElement(table_el, 'panes')
pane_el  = ET.SubElement(panes_el, 'pane')

encodings_el = ET.SubElement(pane_el, 'encodings')
# (add color/size/text encodings here if needed)

mark_el = ET.SubElement(pane_el, 'mark')
mark_el.set('class', 'Bar')

# <rows> and <cols>
rows_el = ET.SubElement(table_el, 'rows')
rows_el.text = f'[{DS_NAME}].[none:Customer Name:nk]'

cols_el = ET.SubElement(table_el, 'cols')
cols_el.text = f'[{DS_NAME}].[sum:Sales:qk]'

# Append worksheet
root.find('worksheets').append(ws_el)

# --- Build matching <window> ---
win_el = ET.Element('window')
win_el.set('class',     'worksheet')
win_el.set('maximized', 'true')
win_el.set('name',      SHEET_NAME)

root.find('windows').append(win_el)

tree.write(OUTPUT_FILE, encoding='utf-8', xml_declaration=True)
print(f'Saved to {OUTPUT_FILE}')
# Then: tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })
```

---

## Add a categorical filter

```python
import xml.etree.ElementTree as ET

USER_NS = 'http://www.tableausoftware.com/xml/user'
ET.register_namespace('user', USER_NS)

WORKBOOK_FILE  = 'cache/workbook-XXXX.xml'
OUTPUT_FILE    = '/tmp/modified_workbook.xml'
DS_NAME        = 'federated.XXXX'
SHEET_NAME     = 'My Sheet'
FILTER_FIELD   = 'Category'                     # raw field name, no brackets
INCLUDE_VALUES = ['Furniture', 'Technology']    # string members to include

tree = ET.parse(WORKBOOK_FILE)
root = tree.getroot()

ws   = root.find(f"worksheets/worksheet[@name='{SHEET_NAME}']")
view = ws.find('table/view')

# Filter column reference uses the raw field name (NOT a column-instance name)
filter_el = ET.SubElement(view, 'filter')
filter_el.set('class',  'categorical')
filter_el.set('column', f'[{DS_NAME}].[{FILTER_FIELD}]')

outer_gf = ET.SubElement(filter_el, 'groupfilter')
outer_gf.set('function', 'union')
outer_gf.set(f'{{{USER_NS}}}ui-marker', 'union')

for val in INCLUDE_VALUES:
    member_gf = ET.SubElement(outer_gf, 'groupfilter')
    member_gf.set('function', 'member')
    member_gf.set('level',    f'[{FILTER_FIELD}]')
    member_gf.set('member',   val)
    # Boolean field values must be "True"/"False" (capital T/F), not "true"/"false"

tree.write(OUTPUT_FILE, encoding='utf-8', xml_declaration=True)
print(f'Saved to {OUTPUT_FILE}')
# Then: tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })
```

---

## Duplicate and modify a worksheet

Deep-clone an existing worksheet and patch only what changes. Much faster than building from scratch.

```python
import xml.etree.ElementTree as ET
import copy

USER_NS = 'http://www.tableausoftware.com/xml/user'
ET.register_namespace('user', USER_NS)

WORKBOOK_FILE = 'cache/workbook-XXXX.xml'
OUTPUT_FILE   = '/tmp/modified_workbook.xml'
SOURCE_SHEET  = 'Monthly Sales'
NEW_SHEET     = 'Monthly Sales - Line'

tree = ET.parse(WORKBOOK_FILE)
root = tree.getroot()

# Find source worksheet and window
source_ws  = root.find(f"worksheets/worksheet[@name='{SOURCE_SHEET}']")
source_win = root.find(f"windows/window[@name='{SOURCE_SHEET}']")

# Deep clone
new_ws  = copy.deepcopy(source_ws)
new_win = copy.deepcopy(source_win)

# Rename
new_ws.set('name',  NEW_SHEET)
new_win.set('name', NEW_SHEET)

# Patch mark type to Line (was Bar)
mark_el = new_ws.find('table/panes/pane/mark')
if mark_el is not None:
    mark_el.set('class', 'Line')

# Append to tree
root.find('worksheets').append(new_ws)
root.find('windows').append(new_win)

tree.write(OUTPUT_FILE, encoding='utf-8', xml_declaration=True)
print(f"Created '{NEW_SHEET}' as clone of '{SOURCE_SHEET}' with Line mark type")
# Then: tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })
```

**Typical things to patch between variants:** `<mark class>`, `<rows>`/`<cols>` text content, filter member values, encoding columns. Everything else (datasource-dependencies, column-instances, computed-sort) can stay identical.

---

## Print workbook structure summary

Diagnostic script — run first to understand datasource IDs, field names, and sheet names before writing modification scripts.

```python
import xml.etree.ElementTree as ET

ET.register_namespace('user', 'http://www.tableausoftware.com/xml/user')

WORKBOOK_FILE = 'cache/workbook-XXXX.xml'  # path from tableau-get-workbook

tree = ET.parse(WORKBOOK_FILE)
root = tree.getroot()

print('=== DATASOURCES ===')
for ds in root.find('datasources'):
    name    = ds.get('name', '')
    caption = ds.get('caption', name)
    cols    = ds.findall('column')
    calcs   = [c for c in cols if c.find('calculation') is not None]
    print(f'  [{name}]  caption="{caption}"  columns={len(cols)} ({len(calcs)} calcs)')
    for col in cols[:10]:  # first 10 fields
        cn = col.get('caption') or col.get('name', '')
        calc = col.find('calculation')
        tag  = f' = {calc.get("formula", "")}' if calc is not None else ''
        print(f'      {cn} ({col.get("datatype","")}/{col.get("role","")}){tag}')
    if len(cols) > 10:
        print(f'      ... and {len(cols)-10} more')

print()
print('=== WORKSHEETS ===')
for ws in root.find('worksheets'):
    print(f'  {ws.get("name","")}')
    view = ws.find('table/view')
    if view is not None:
        for filt in view.findall('filter'):
            print(f'      filter: {filt.get("class","")} on {filt.get("column","")}')

dashboards_el = root.find('dashboards')
if dashboards_el is not None:
    print()
    print('=== DASHBOARDS ===')
    for db in dashboards_el:
        print(f'  {db.get("name","")}')

print()
print('=== WINDOWS ===')
for w in root.find('windows'):
    print(f'  {w.get("name","")}  class={w.get("class","")}')
```

---

## When to Use

Use this module when you need to:

- **Write Python scripts** to modify Tableau workbook XML (add fields, worksheets, filters, dashboards)
- Get a **ready-to-use namespace setup** for round-trip-safe `user:` attribute handling
- **Clone/duplicate a worksheet** as a starting point for a similar chart
- **Add a calculated field** to a datasource via Python
- **Add a categorical filter** to a worksheet via Python
- **Inspect datasource fields** programmatically (dimensions, measures, calculated fields)
- Use **structural helpers** (`find_datasource`, `find_worksheet`, `find_window`) to navigate the XML tree

For column-instances, filters, and encodings, see `workbook-worksheets.md`, `workbook-filters.md`, `workbook-encodings.md`.

---

## Best Practices

- **Always call `tableau-get-workbook` immediately before any modification**: The cached file path changes after each `tableau-apply-workbook` call. Using a stale path will silently overwrite all intermediate changes.
- **Always register the `user:` namespace prefix** before writing XML: `ET.register_namespace('user', USER_NS)`. Without it, `user:ui-marker` attrs are written in Clark notation and Tableau rejects the file.
- **Save to `/tmp/modified_workbook.xml`** and submit via `tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })`. Never submit the cache file directly.
- **Submit incrementally**: Add one worksheet at a time and verify with worksheet-list readback before adding the next. Submitting many changes at once makes it difficult to isolate failures.
- **Use `copy.deepcopy` when cloning worksheets**: Shallow copies share child element references — mutations affect both the original and the clone.

---

## Common Mistakes

1. **Forgetting the `window` entry**: Every new worksheet needs both a `<worksheet>` node in `<worksheets>` AND a `<window>` node in `<windows>`. Omitting the window causes the sheet to be silently dropped.
2. **Re-using a stale cached file path**: Each `tableau-apply-workbook` updates the workbook state. Always call `tableau-get-workbook` to get the fresh path before the next modification.
3. **Not generating a new UUID for cloned windows**: When cloning a worksheet + window, always generate a new UUID for the window's `simple-id` node. Duplicate UUIDs cause Tableau to silently drop one of the windows.
4. **Setting `user:` attributes without the namespace registration**: Without `ET.register_namespace('user', USER_NS)`, the attribute is written as `{http://...}ui-marker` in Clark notation, which Tableau does not accept.
5. **Navigating by index instead of by attribute**: The element order inside `worksheets`, `windows`, and `datasources` is not guaranteed. Always find elements by name attribute, not by positional index.

---

## Implementation

The standard Python workflow for any workbook modification:

1. Call `tableau-get-workbook` — returns `{ filePath, fileUrl }` pointing to the current cached XML file.
2. Parse the XML: `tree = ET.parse(WORKBOOK_FILE); root = tree.getroot()`.
3. Navigate to the target node using the helper functions (`find_datasource`, `find_worksheet`, `find_window`) or XPath.
4. Apply the modification (add column, create worksheet, inject filter, etc.).
5. Write the modified tree: `tree.write('/tmp/modified_workbook.xml', encoding='utf-8', xml_declaration=True)`.
6. Submit: `tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })`.
7. Verify with worksheet-list readback or `tableau-get-workbook`.

See the complete templates in the sections above for each specific operation.

## Source and Confidence

- Source/evidence type: design best-practice
- Source: Ready-to-use ElementTree stdlib templates synthesized from the corpus's confirmed XML patterns; no customer data
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
