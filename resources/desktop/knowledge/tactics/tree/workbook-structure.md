# Workbook XML: Structure Reference

Full reference for the Tableau TWB XML file saved by `tableau-get-workbook`. Use this when navigating the tree, building Python scripts, or debugging structure errors.


---

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, refine, troubleshoot
- In-scope reason: Enables Claude to navigate the TWB XML tree and modify worksheets, dashboards, datasources, and stories correctly.
- Out-of-scope risk: none
- Tags: workbook-structure, twb, xml-tree, datasources, worksheets, dashboards, windows, stories, storyboard, story-points, navigation
- Relevant user prompts/search terms: "TWB XML tree structure", "where do dashboards live in the workbook XML", "navigate the workbook XML with Python", "what XML does a Tableau story use", "story points storyboard XML shape", "find a node in the workbook", "nodes to never modify"

## Workflow

```
tableau-get-workbook        → saves cache/workbook-XXXX.xml
edit cache/workbook-XXXX.xml (Python or shell)
tableau-apply-workbook({ workbook_file: "cache/workbook-XXXX.xml" })
```

The `tableau-get-workbook` tool returns the cache file path. Pass that exact path to your Python script, save modified XML to `/tmp/modified_workbook.xml`, then submit with `tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })`.

---

## TWB XML tree

```
<workbook version="18.1" xmlns:user="http://www.tableausoftware.com/xml/user">
  <document-format-change-manifest>   ← DO NOT MODIFY
  <preferences>
  <datasources>
    <datasource name="federated.XXXX" caption="My Data" inline="true" version="18.1">
      <connection class="federated">   ← DO NOT MODIFY
        <named-connections>            ← DO NOT MODIFY
        <relation .../>
      </connection>
      <column name="[Sales]" caption="Sales" role="measure" type="quantitative" datatype="real"/>
      <column name="[Calculation_001]" caption="My Calc" role="measure" type="quantitative" datatype="real">
        <calculation class="tableau" formula="SUM([Sales])"/>
      </column>
    </datasource>
    <datasource name="Parameters">    ← DO NOT MODIFY — parameter definitions live here
  </datasources>
  <worksheets>
    <worksheet name="Sheet 1">
      <table>
        <view>
          <datasources>
            <datasource name="federated.XXXX" caption="My Data"/>
          </datasources>
          <datasource-dependencies datasource="federated.XXXX">
            <column-instance column="[Sales]" derivation="Sum" name="[sum:Sales:qk]" pivot="key" type="quantitative"/>
            <column-instance column="[Category]" derivation="None" name="[none:Category:nk]" pivot="key" type="nominal"/>
          </datasource-dependencies>
          <filter class="categorical" column="[federated.XXXX].[Category]">
            <groupfilter function="union" user:ui-marker="union">
              <groupfilter function="member" level="[Category]" member="Furniture"/>
            </groupfilter>
          </filter>
        </view>
        <panes>
          <pane>
            <encodings>
              <color column="[federated.XXXX].[none:Category:nk]"/>
            </encodings>
            <mark class="Bar"/>
          </pane>
        </panes>
        <rows>[federated.XXXX].[none:Category:nk]</rows>
        <cols>[federated.XXXX].[sum:Sales:qk]</cols>
      </table>
    </worksheet>
  </worksheets>
  <dashboards>
    <dashboard name="Dashboard 1">
      <zones>
        <zone h="100000" id="1" type-v2="layout-basic" w="100000" x="0" y="0">
          <zone h="50000" id="2" name="Sheet 1" type-v2="visual" w="100000" x="0" y="0"/>
        </zone>
      </zones>
    </dashboard>
  </dashboards>
  <windows>
    <window class="worksheet" maximized="true" name="Sheet 1">
      <cards>
        <edge name="left"><strip size="160">...</strip></edge>
        <edge name="top"><strip size="31"><card type="columns"/></strip></edge>
      </cards>
    </window>
  </windows>
</workbook>
```

---

## Stories: two XML shapes

A Tableau **story** is a sequential deck of "story points," each capturing a dashboard or worksheet plus a navigator caption. There are **two on-disk shapes**, and code that reads or edits stories must handle both:

- **Older shape:** a top-level `<story name='…'>` element containing `<flipboard><story-points><story-point …/></story-points></flipboard>`.
- **Newer shape:** a `<dashboard name='…' type-v2='storyboard'>` that wraps the same `flipboard` / `story-points` tree. These live in the `<dashboards>` node and look like dashboards — detect the `type-v2='storyboard'` attribute so you don't treat a storyboard's flipboard chrome as a normal dashboard zone layout.

Each `<story-point>` references a `captured-sheet` (a dashboard or a worksheet by name) and carries the navigator caption. Resolve `captured-sheet` against the workbook's dashboard and worksheet name sets to know whether a point captures a whole dashboard or a single worksheet.

What is **not** separately recoverable from the XML: per-point filter/highlight **state divergence** (two story points capturing the same sheet with different filters look the same structurally — the differing state isn't a clean diff), and Tableau "update" points that re-capture a modified state. Treat those as manual when reproducing a story elsewhere.

---

## Navigating with Python (xml.etree.ElementTree)

Use stdlib `xml.etree.ElementTree` — no extra dependencies needed.

```python
import xml.etree.ElementTree as ET

# Preserve namespaces on round-trip
ET.register_namespace('user', 'http://www.tableausoftware.com/xml/user')
ET.register_namespace('', '')  # default namespace (none)

tree = ET.parse('cache/workbook-XXXX.xml')
root = tree.getroot()  # <workbook> element

# Top-level sections
datasources_el  = root.find('datasources')
worksheets_el   = root.find('worksheets')
dashboards_el   = root.find('dashboards')
windows_el      = root.find('windows')

# Find a datasource by name attribute
def find_datasource(root, ds_name):
    for ds in root.find('datasources'):
        if ds.get('name') == ds_name:
            return ds
    return None

# Find a worksheet by name attribute
def find_worksheet(root, sheet_name):
    for ws in root.find('worksheets'):
        if ws.get('name') == sheet_name:
            return ws
    return None

# XPath: find the view node inside a named worksheet
ws = find_worksheet(root, 'Sheet 1')
view = ws.find('table/view')
ds_deps = view.find("datasource-dependencies[@datasource='federated.XXXX']")
```

### Key XPath patterns

| Goal | XPath from `root` |
|---|---|
| All datasources | `root.findall('datasources/datasource')` |
| Specific datasource | `root.find("datasources/datasource[@name='federated.XXXX']")` |
| All worksheets | `root.findall('worksheets/worksheet')` |
| Named worksheet | `root.find("worksheets/worksheet[@name='Sheet 1']")` |
| View inside worksheet | `ws.find('table/view')` |
| DS-deps in view | `view.find("datasource-dependencies[@datasource='federated.XXXX']")` |
| All filters in view | `view.findall('filter')` |
| All column-instances | `ds_deps.findall('column-instance')` |
| Named window | `root.find("windows/window[@name='Sheet 1']")` |
| Named dashboard | `root.find("dashboards/dashboard[@name='Dashboard 1']")` |

---

## Namespace handling

The `xmlns:user` namespace is used for filter attributes like `user:ui-marker` and `user:ui-enumeration`. ElementTree expands these to Clark notation internally: `{http://www.tableausoftware.com/xml/user}ui-marker`.

```python
USER_NS = 'http://www.tableausoftware.com/xml/user'

# Setting a user: attribute
groupfilter_el.set(f'{{{USER_NS}}}ui-marker', 'union')

# Reading a user: attribute
val = groupfilter_el.get(f'{{{USER_NS}}}ui-marker')
```

Register the namespace prefix before writing so the output uses `user:` not the Clark form:

```python
ET.register_namespace('user', USER_NS)
tree.write('/tmp/modified_workbook.xml', encoding='utf-8', xml_declaration=True)
```

---

## Saving and submitting

```python
tree.write('/tmp/modified_workbook.xml', encoding='utf-8', xml_declaration=True)
# Then call: tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })
```

Verify with `get_sheets_info` after submission.

---

## Nodes to NEVER modify

| Node | Location | Why |
|---|---|---|
| `document-format-change-manifest` | direct child of `<workbook>` | Version compatibility metadata |
| `repository-location` | direct child of `<workbook>` | Workbook file path on server |
| `connection` | inside each `<datasource>` | DB/file connection strings and paths |
| `named-connections` | inside each `<datasource>` | Connection definitions with live file paths |
| `datasource-relationships` | direct child of `<workbook>` | Relationship definitions between datasources |
| `datasource[@name='Parameters']` | in `<datasources>` | Each `<column>` child is a parameter definition |

**TWBX temp paths:** When a `.twbx` is open, `connection`/`named-connections` paths point to OS temp folders (e.g. `/var/folders/xx/.../Orders.hyper`). These are correct and live — never rewrite them.

**Published datasources:** Have `connection class="sqlproxy"`. Local file-based use `"hyper"`, `"excel-direct"`, `"textscan"`. Do not change the class.

---

## When to Use

Use this module when you need to:
- **Understand the workbook XML / TWB tree** and navigate it correctly (or the JSON representation when using converters)
- **Find a specific node** — a datasource, worksheet, window, dashboard, or actions node
- **Add a calculated field** to an existing datasource
- **Create a new worksheet** with the required companion `window` node
- **Know which nodes to preserve** — connection strings, repository-location, datasource-relationships, Parameters datasource

For column-instances, mark encodings, and worksheet internals, see `workbook-worksheets.md` and `workbook-encodings.md`.

---

## Best Practices

- **Navigate by structure, not fragile indices**: Node order can vary; identify nodes by element name / role rather than assuming fixed child positions.
- **Never modify preserved nodes**: `connection`, `named-connections`, `repository-location`, `datasource-relationships`, and `document-format-change-manifest` must not be changed without an explicit user request.
- **Use a fresh workbook snapshot before every modification**: After `tableau-apply-workbook`, re-read with `tableau-get-workbook` (or file path from the tool) so you are not editing stale XML.
- **Always pair worksheet + window additions**: A new worksheet without a matching `window` entry can be dropped or invisible in Tableau.
- **Never guess datasource IDs**: Datasource `name` values like `federated.XXXX` come from Tableau — read them from the live workbook XML.
- **TWBX temp paths are valid**: When a `.twbx` is open, connection paths may point at OS temp folders; do not rewrite them.

---

## Common Mistakes

1. **Index-based tree traversal** against parsed JSON: prefer name/type navigation; order is not stable across round-trips.
2. **Adding a dashboard under `worksheets`**: Dashboards belong in `dashboards`; wrong placement can crash load.
3. **Modifying the `Parameters` datasource unintentionally**: Skip unless the user asked to edit parameters.
4. **Re-using stale cached workbook files** across multiple apply calls without re-fetching from Tableau.
5. **Omitting `datasources` inside `view`**: Worksheet views need both datasource reference and `datasource-dependencies` as required by Tableau.

---

## Implementation (Tableau Desktop MCP)

Typical flow with XML on disk:

1. `tableau-get-workbook` → edit the returned `.xml` path (or use `mode=inline` for small workbooks).
2. Apply structural changes following the modules above.
3. `tableau-apply-workbook` with the modified file path.
4. Verify with `tableau-list-worksheets` / `tableau-list-dashboards`.

---

## What to safely add or modify

| What | Where |
|---|---|
| `<column>` with `<calculation>` child | inside the target `<datasource>` |
| `<worksheet>` + matching `<window>` | `<worksheets>` and `<windows>` respectively |
| `<dashboard>` | `<dashboards>` |
| Mark type | `<mark class="...">` inside `<pane>` |
| Encodings (color, size, text) | `<encodings>` inside `<pane>` |
| Rows/cols shelf | `<rows>` and `<cols>` text content inside `<table>` |
| Filters | `<filter>` children of `<view>` |

**Every new worksheet needs a matching `<window>` node** — missing the window entry causes `load-underlying-metadata` to silently fail.

---

## When to Use

Use this module when you need to:

- Understand the **overall TWB XML file structure** (element hierarchy, node ordering)
- Know which **nodes are safe to modify** vs. which must never be touched
- Get the **correct XPath patterns** for navigating the tree with Python's `xml.etree.ElementTree`
- Understand **namespace handling** for `user:` prefixed attributes
- Know the standard **save-and-submit workflow** (`tableau-get-workbook` → modify → `tableau-apply-workbook`)

For chart-specific XML patterns, see the other knowledge modules (`workbook-worksheets.md`, `workbook-encodings.md`, etc.).

---

## Best Practices

- **Never modify `connection`, `named-connections`, `document-format-change-manifest`, `repository-location`, or the `Parameters` datasource**: These nodes contain workbook metadata and live connection state. Modifying them breaks the workbook.
- **Always register the `user:` namespace prefix** before writing: `ET.register_namespace('user', 'http://www.tableausoftware.com/xml/user')`. Otherwise `user:` attrs are written in Clark notation.
- **Call `tableau-get-workbook` immediately before every modification**: The cached file path changes after each `tableau-apply-workbook`. Always use the freshest path.
- **Navigate by attribute, not by index**: Element order inside `worksheets`, `datasources`, and `windows` is not guaranteed. Use `find()` with attribute predicates, not `[0]`/`[1]` indexing.
- **Every new worksheet requires a matching `window` entry**: Missing the window entry causes `load-underlying-metadata` to silently fail and the sheet to be dropped.

---

## Common Mistakes

1. **Modifying `connection` or `named-connections`**: These nodes contain live file paths (including OS temp paths for open `.twbx` files). Changing them breaks the datasource connection.
2. **Adding a dashboard to `worksheets`**: Dashboards belong in the `dashboards` node. Adding a dashboard to `worksheets` causes Tableau to crash on load.
3. **Forgetting the `window` entry for a new worksheet**: This is the most common cause of "sheet disappeared after submission." Always submit worksheet + window together.
4. **Using positional indexing to navigate the tree**: The `worksheets`, `windows`, and `datasources` elements may contain elements in any order. Always find by name attribute.
5. **Re-using a stale cached file path**: After each `tableau-apply-workbook`, the workbook state is updated. Submitting from a stale file silently discards all intermediate changes.

---

## Implementation

The standard Python workflow for any workbook modification:

1. **Get the current file path**: Call `tableau-get-workbook` — returns `{ filePath, fileUrl }` pointing to the cached XML.
2. **Parse**: `tree = ET.parse(WORKBOOK_FILE); root = tree.getroot()` — root is the `<workbook>` element.
3. **Navigate** using `root.find('datasources')`, `root.find('worksheets')`, `root.find('windows')`, `root.find('dashboards')`.
4. **Modify**: append, set attributes, or remove elements as needed (see other modules for specifics).
5. **Write**: `tree.write('/tmp/modified_workbook.xml', encoding='utf-8', xml_declaration=True)`.
6. **Submit**: `tableau-apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })`.
7. **Verify**: call `tableau-list-worksheets` or `tableau-get-workbook` to confirm changes applied.

## Source and Confidence

- Source/evidence type: field-tested
- Source: Live Tableau Desktop workbook XML observation and round-trip testing
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-07-03
