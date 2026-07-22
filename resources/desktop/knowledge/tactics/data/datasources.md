# Workbook XML: Adding and Refactoring Datasources

Confirmed patterns for injecting, connecting, and refactoring datasources in Tableau Desktop workbooks via `apply-workbook`. All patterns validated via live `get-workbook-xml` / `apply-workbook` observation.


---

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, refine, troubleshoot
- In-scope reason: Enables Claude to inject, connect, and refactor datasources via apply-workbook.
- Out-of-scope risk: none
- Tags: datasources, connections, relationships, joins, object-graph, custom-sql, tdsx, blending, data-blend, field-roles, captions, descriptions
- Relevant user prompts/search terms: "refactor custom SQL to native tables", "multi-table relationships object-graph", "inject a tdsx datasource", "tell a data blend from a join", "how is a blend encoded in the workbook XML", "linking fields primary secondary datasource", "add a calculated field to a datasource", "set field captions and descriptions"

## When to Use

Use this module when you need to:

- **Refactor a custom SQL datasource** into a native Tableau data model with table relationships
- **Inject a local `.tdsx` datasource** into a workbook programmatically
- **Connect a new database datasource** (postgres, SQL Server, etc.) with multiple tables
- **Understand the datasource node structure** (connection class, named-connections, object-graph, column nodes)
- **Identify a datasource's internal ID** (`federated.XXXX` format) for use in `datasource-dependencies`
- **Add calculated fields** to replace SQL-computed columns after refactoring

For understanding how datasource fields are referenced within worksheets (column defs, column-instances), see `expertise://tableau/tactics/viz/worksheets`.

---

## Refactoring Custom SQL to Native Tables

The most common datasource refactoring: replace a `<relation type='text'>` (custom SQL) with native table objects connected via Tableau relationships. This gives users the full data model UI, lets Tableau optimize queries, and makes the datasource maintainable.

### Analysis workflow

1. **Read the custom SQL** from the workbook XML (inside `<relation type='text'><![CDATA[...]]>`)
2. **Identify the physical tables** referenced (e.g. `FROM "TableA" JOIN "TableB" ON ...`)
3. **Identify join keys** between tables
4. **Identify computed columns** (aggregations, CASE expressions, window functions) — these become Tableau calculated fields
5. **Map SQL aliases back to physical column names** — the native model exposes raw column names

### Confirmed working XML pattern

This is the structure for a native multi-table postgres datasource with relationships, extracted from a confirmed working workbook:

```xml
<datasource caption='My Refactored DS' inline='true' name='federated.my_ds_01' version='18.1'>
  <connection class='federated'>
    <named-connections>
      <named-connection caption='localhost' name='postgres.my_conn'>
        <connection authentication='username-password' class='postgres'
                    dbname='mydb' one-time-sql='' port='5432'
                    server='localhost' username='postgres' />
      </named-connection>
    </named-connections>
    <!-- relation type='collection' wraps the individual tables -->
    <relation type='collection'>
      <relation connection='postgres.my_conn' name='Transactions'
                table='[public].[transactions]' type='table' />
      <relation connection='postgres.my_conn' name='Customers'
                table='[public].[customers]' type='table' />
      <relation connection='postgres.my_conn' name='Dates'
                table='[public].[dates]' type='table' />
    </relation>
    <metadata-records>
      <!-- One metadata-record per column per table.
           CRITICAL: <object-id> must match the object id in the object-graph -->
      <metadata-record class='column'>
        <remote-name>customer_id</remote-name>
        <remote-type>20</remote-type>
        <local-name>[customer_id]</local-name>
        <parent-name>[Transactions]</parent-name>
        <remote-alias>customer_id</remote-alias>
        <ordinal>1</ordinal>
        <local-type>integer</local-type>
        <aggregation>Sum</aggregation>
        <precision>19</precision>
        <contains-null>false</contains-null>
        <object-id>[Transactions]</object-id>
      </metadata-record>
      <!-- ... more metadata-records for each column ... -->
    </metadata-records>
  </connection>
  <aliases enabled='yes' />
  <!-- Column definitions for computed/calculated fields go here,
       BEFORE <semantic-values> and <object-graph> -->
  <layout dim-ordering='alphabetic' measure-ordering='alphabetic' show-structure='true' />
  <semantic-values>
    <semantic-value key='[Country].[Name]' value='&quot;United States&quot;' />
  </semantic-values>
  <object-graph>
    <objects>
      <object caption='Transactions' id='Transactions'>
        <properties context=''>
          <relation connection='postgres.my_conn' name='Transactions'
                    table='[public].[transactions]' type='table' />
        </properties>
      </object>
      <object caption='Customers' id='Customers'>
        <properties context=''>
          <relation connection='postgres.my_conn' name='Customers'
                    table='[public].[customers]' type='table' />
        </properties>
      </object>
      <object caption='Dates' id='Dates'>
        <properties context=''>
          <relation connection='postgres.my_conn' name='Dates'
                    table='[public].[dates]' type='table' />
        </properties>
      </object>
    </objects>
    <relationships>
      <relationship>
        <expression op='='>
          <expression op='[customer_id]' />
          <expression op='[cust_sk]' />
        </expression>
        <first-end-point object-id='Transactions' />
        <second-end-point object-id='Customers' />
      </relationship>
      <relationship>
        <expression op='='>
          <expression op='[date_fk]' />
          <expression op='[date_sk]' />
        </expression>
        <first-end-point object-id='Transactions' />
        <second-end-point object-id='Dates' />
      </relationship>
    </relationships>
  </object-graph>
</datasource>
```

### Key structural rules

| Element | Rule |
|---|---|
| `<relation type='collection'>` | Wraps all tables in a multi-table datasource. Each child is `type='table'`. |
| `<object id='...'>` | Must match `<object-id>[...]</object-id>` in metadata-records for that table's columns. |
| `<relationship>` | Defines a join. `<expression op='='>` with two child `<expression op='[column]'>` nodes. |
| `<first-end-point>` | The "from" side of the relationship (typically the fact table). |
| `<second-end-point>` | The "to" side (typically the dimension table). |
| `connection='...'` attribute | Must match the `name` attribute of the `<named-connection>`. |

### Field roles, captions, and descriptions

Generated datasource fields should be analysis-ready, not just technically loadable. When adding column definitions, default to clean display names, semantic field roles, and descriptive comments.

- **Classify by semantics, not datatype**: Numeric unique identifiers such as `match_id`, `customer_id`, row IDs, and keys are dimensions/non-additive. Use measures only for values users should sum, average, count, or otherwise aggregate.
- **Use clean captions**: Preserve the raw field reference in `name='[source_url]'`, but add a `caption='Source URL'` when the source name is technical, snake_case, or otherwise less readable. Prefer names from connection metadata first, then a data dictionary or enterprise catalog, then a high-confidence agent cleanup.
- **Add field descriptions by default**: If the datasource metadata includes comments, labels, or descriptions, carry them into Tableau. If not, use a data dictionary or enterprise catalog when available. If none exists and confidence is high, add an agent-generated description that explains what the field is, how it is calculated, where it is sourced, and when to use it.
- **Use Tableau's description XML shape**: Put comments under the datasource `<column>` as `<desc><formatted-text><run>...</run></formatted-text></desc>`. Escape XML special characters.

Example:

```xml
<column caption='Source URL' datatype='string' name='[source_url]' role='dimension' type='nominal'>
  <desc>
    <formatted-text>
      <run>Link to the website or source used to populate the row. Use for auditability and provenance, not as an analytical grouping.</run>
    </formatted-text>
  </desc>
</column>
<column caption='Match ID' datatype='integer' name='[match_id]' role='dimension' type='ordinal'>
  <desc>
    <formatted-text>
      <run>Unique identifier for the match row. Use to identify or count matches; do not sum or average it.</run>
    </formatted-text>
  </desc>
</column>
```

### What does NOT work

- **`<relation type='join'>`**: This is the old-style join syntax (pre-relationships). Use `<object-graph>` with `<relationships>` instead.
- **Omitting `<object-id>` in metadata-records**: Causes Tableau to bind columns to the wrong logical table. Every metadata-record must have an `<object-id>` matching its parent object.
- **Omitting `<object-graph>`**: Without it, Tableau doesn't know about the logical model and the tables appear disconnected.
- **Mismatched `<relation name='...'>` and `<object caption='...'>`**: The `name` in the collection relation must correspond to the object graph. Keep them consistent.

### Translating SQL computed columns to Tableau calculated fields

After refactoring, SQL-computed columns (aggregations, CASE, window functions) become Tableau calculated fields using LOD expressions:

| SQL Pattern | Tableau Equivalent |
|---|---|
| `SUM(col) ... GROUP BY customer` | `{FIXED [Customer]: SUM([Col])}` |
| `COUNT(DISTINCT col) ... GROUP BY customer` | `{FIXED [Customer]: COUNTD([Col])}` |
| `AVG(col) ... GROUP BY customer` | `{FIXED [Customer]: AVG([Col])}` |
| `MAX(date_col) ... GROUP BY customer` | `{FIXED [Customer]: MAX([Date Col])}` |
| `CURRENT_DATE - date_col` | `DATEDIFF('day', [Date Col], TODAY())` |
| `NTILE(5) OVER (ORDER BY col)` | No direct equivalent — use rank-based binning with `{FIXED: MIN/MAX}` range mapping |
| `CASE WHEN ... THEN ... END` | `IF ... THEN ... ELSEIF ... END` |
| `col1 \|\| col2` (concat) | `STR([Col1]) + STR([Col2])` |

### Validation workflow

After refactoring, build side-by-side comparison worksheets:

1. Create a worksheet using the **original** custom SQL datasource showing a key metric (e.g. SUM of sales by segment)
2. Create a matching worksheet using the **refactored** native datasource showing the same metric
3. Place both on a dashboard for visual comparison
4. Check totals and per-dimension breakdowns match

---

## Connected datasource structure (for reference)

When inspecting an existing connected datasource via `get-workbook-xml`, the element looks like:

```xml
<datasource name="federated.0rogfc80n0surr1dg0o9r08ppyl0"
            caption="Run the Business PDS"
            inline="true">
  <connection class="hyper"
              dbname="/tmp/rtb_extract/Data/Datasources/extract.hyper"
              schema="Extract"
              tablename="Extract"/>
  <!-- ... columns, column-instances, etc. -->
</datasource>
```

**Connection class by datasource type:**
- Local extract (`.hyper`) → `class="hyper"`
- Excel → `class="excel-direct"`
- Text/CSV → `class="textscan"`
- PostgreSQL → `class="postgres"` (inside `class="federated"` wrapper)
- SQL Server → `class="sqlserver"`
- Published datasource (Tableau Server/Cloud) → `class="sqlproxy"`

---

## Recognizing data blending (vs a join)

A **data blend** combines two *separate* datasources at query time on same-named "linking fields" — distinct from a join, which combines tables *inside one* datasource. The difference is visible in the worksheet XML:

- A worksheet using a blend lists **2+ real datasources** in its `<view>` (the `Parameters` datasource doesn't count), and carries a **`<datasource-dependencies datasource='<secondary>'>`** block that pulls fields from the secondary source.
- A `<join>` (or `<relation type='join'>` / `<relationships>`) lives **inside a single `<datasource>`** and never produces a secondary dependencies block. If there's no secondary `datasource-dependencies` block, it's a join/relationship, not a blend.

Key facts when you encounter one:

- **The primary is the first datasource in the worksheet's `<view>` list.** Tableau aggregates the **secondary to the linking-field grain before joining** — so a blended secondary measure is effectively pre-aggregated (and behaves as non-additive at finer grains).
- **Linking fields default to same-named captions** present in both datasources' dependency blocks. Tableau also allows **custom (renamed) link pairs** via Data → Edit Blend Relationships — those are NOT inferable from same-name matching; read the blend relationship to know them.
- **Blending is a worksheet-level construct, not a datasource-level one.** There is no single combined datasource node to author; the relationship is expressed through the dual datasource dependencies on the worksheet. Authoring a blend from scratch via XML is fragile — prefer a relationship/join in one datasource when the data is reachable from one connection, and reserve blending for genuinely separate sources.

---

## Injecting a local `.tdsx` datasource

A `.tdsx` file is a standard zip archive containing a `.tds` (datasource XML) and one or more `.hyper` (extract) files. Since we work directly with XML, the `.tds` inside the archive can be parsed directly with `xml.etree.ElementTree` — no conversion library needed.

### Complete recipe

```python
import xml.etree.ElementTree as ET
import zipfile, os, shutil

TDSX_PATH = '<local-path>/My Tableau Repository/Datasources/MyDatasource.tdsx'
EXTRACT_DIR = '/tmp/tdsx_extract'
WORKBOOK_XML = 'cache/workbook-XXXX.xml'  # path from get-workbook-xml

# Step 1: Unzip the .tdsx
os.makedirs(EXTRACT_DIR, exist_ok=True)
with zipfile.ZipFile(TDSX_PATH, 'r') as z:
    z.extractall(EXTRACT_DIR)

# Find the .tds file inside
tds_files = [f for f in os.listdir(EXTRACT_DIR) if f.endswith('.tds')]
tds_path = os.path.join(EXTRACT_DIR, tds_files[0])

# Step 2: Parse the .tds directly as XML (it already IS XML)
tds_tree = ET.parse(tds_path)
tds_root = tds_tree.getroot()
ds_element = tds_root  # tds root IS the datasource element

# Step 3: Clean up attributes that cause load errors
for attr in ('source-platform', '{http://www.w3.org/2001/XMLSchema-instance}user'):
    ds_element.attrib.pop(attr, None)

# Ensure caption is set
if 'caption' not in ds_element.attrib:
    ds_element.set('caption', 'My Datasource')

# Step 4: Remove document-format-change-manifest child (causes errors)
for child in list(ds_element):
    if child.tag == 'document-format-change-manifest':
        ds_element.remove(child)

# Step 5: Find the .hyper file and patch connection paths
hyper_files = []
for dirpath, _, files in os.walk(EXTRACT_DIR):
    for f in files:
        if f.endswith('.hyper'):
            hyper_files.append(os.path.abspath(os.path.join(dirpath, f)))

if hyper_files:
    hyper_path = hyper_files[0]
    conn = ds_element.find('connection')
    if conn is not None:
        conn.set('dbname', hyper_path)
    for nc in ds_element.iter('named-connection'):
        inner_conn = nc.find('connection')
        if inner_conn is not None:
            inner_conn.set('dbname', hyper_path)

# Step 6: Parse workbook XML and inject the datasource element
wb_tree = ET.parse(WORKBOOK_XML)
wb_root = wb_tree.getroot()
datasources_node = wb_root.find('.//datasources')
datasources_node.append(ds_element)

# Step 7: Save modified workbook and submit
wb_tree.write('/tmp/modified_workbook.xml', encoding='utf-8', xml_declaration=True)
```

Then submit: `apply-workbook({ workbook_file: "/tmp/modified_workbook.xml" })`

### Key transformation rules

| Transform | Why |
|---|---|
| Delete `source-platform` | Causes load error when present |
| Delete `xmlns:user` | Causes load error when present |
| Set `caption` if missing | Display name in Tableau UI |
| Set `dbname` to absolute hyper path | Must point to the extracted `.hyper` file |
| Remove `document-format-change-manifest` child | Not valid inside a datasource node |

---

## Injecting a local `.xls` / `.xlsx` datasource (minimal definition)

When connecting to an Excel file directly, use a **minimal datasource definition** rather than injecting a full `.tds` file. Full `.tds` files from Tableau's defaults can be 150KB+ with hundreds of aliases, groups, and formatting nodes. A minimal definition (~2KB) is cleaner and avoids bloating the workbook XML.

### Minimal datasource template

```xml
<datasource name='federated.superstore001' caption='Sample - Superstore' inline='true'>
  <connection class='federated'>
    <named-connections>
      <named-connection caption='Sample - Superstore' name='excel-direct.superstore01'>
        <connection class='excel-direct' cleaning='no' compat='no' dataRefreshTime=''
                    filename='C:/Program Files/Tableau/Tableau main/defaults/Datasources/Sample - Superstore.xls'
                    interpretationMode='0' password='' server='' validate='no' />
      </named-connection>
    </named-connections>
    <relation connection='excel-direct.superstore01' name='Orders' table='[Orders$]' type='table'>
      <columns gridOrigin='A1:U9995:no:A1:U9995:0' header='yes' outcome='6'>
        <column datatype='string' name='Category' ordinal='14' />
        <column datatype='real' name='Sales' ordinal='17' />
      </columns>
    </relation>
  </connection>
  <column datatype='string' name='[Category]' role='dimension' type='nominal' />
  <column datatype='real' name='[Sales]' role='measure' type='quantitative' />
</datasource>
```

### Key rules

- **`filename` must be an absolute path** — relative paths break on reload.
- **`connection class='federated'`** wraps the `excel-direct` named-connection — match the two-level pattern.
- **`relation table='[SheetName$]'`** — Excel sheet names use `$` suffix in brackets.
- **Column `ordinal` values must match** the actual Excel column positions (0-based).
- **Tableau auto-discovers additional columns** from the Excel file on load — you don't need to list every column, but the `<relation>` must reference the correct table.

### Finding Tableau's built-in data files

| OS | Path |
|---|---|
| Windows | `C:\Program Files\Tableau\Tableau main\defaults\Datasources\Sample - Superstore.xls` |
| macOS | `/Applications/Tableau Desktop <version>.app/Contents/install/defaults/Datasources/Sample - Superstore.xls` |

---

## Datasource Connection Schema Overrides Worksheet Column Formats

**Confirmed limitation (2026-06-19):** When a field's format is defined at the connection level (e.g. an Excel `.xls` file with `default-format='p0%'` baked into the column schema), that format takes priority over any `default-format` set in:
- Worksheet-level `<column>` defs inside `datasource-dependencies`
- Datasource-level `<column>` defs inside the `<datasource>` node

Tableau strips or ignores both on round-trip. The connection schema wins.

**Example:** Sample - Superstore's Excel connection defines `[Sales]` with `default-format='p0%'`. Any attempt to override it via XML produces `p0%` on the axis after Tableau re-reads the file.

**Only reliable fix:** Manual UI action in Tableau Desktop — right-click the field in the view or on the axis → Format → Numbers → Currency.

**How to apply:** If a field is showing an unexpected format (especially `p0%` from an Excel datasource), do NOT loop through XML attempts. Inform the user this is a connection-schema format that can only be changed manually in Tableau Desktop, and point them to: Right-click axis → Format → Numbers.

---

## Adding Calculated Fields to a Datasource

Local calculated fields can be added to any datasource — including published Tableau Server datasources (`class="sqlproxy"`) — by inserting `<column>` elements directly inside the `<datasource>` node.

### Column placement rules

`<column>` elements must appear **before `<semantic-values>` and `<object-graph>`** (the last children of the datasource). Inserting them after `</object-graph>` causes Tableau to reject the XML.

Correct structure:
```xml
<datasource ...>
  <connection .../>
  <!-- hundreds of existing <column> elements -->
  <column caption="My Calc" ...>  <!-- ← insert new calcs here -->
    <calculation class="tableau" formula="..." />
  </column>
  <style>...</style>
  <semantic-values>...</semantic-values>   <!-- ← BEFORE this -->
  <object-graph>...</object-graph>         <!-- ← and this -->
</datasource>
```

### Metadata-record `<object-id>` is required for multi-table datasources

In datasources with multiple tables, every `<metadata-record class="column">` **must** include an `<object-id>` element that matches the `<object id="...">` in the `<object-graph>` whose `<relation name="...">` is that column's source table.

Without `<object-id>`, Tableau can bind columns to the wrong logical model object — fields appear to belong to a different table, causing broken joins and incorrect query generation.

```xml
<metadata-record class='column'>
  <remote-name>CustomerName</remote-name>
  <remote-type>129</remote-type>
  <local-name>[CustomerName]</local-name>
  <parent-name>[Customers]</parent-name>
  ...
  <object-id>[CustomersObject_ABC123]</object-id>  <!-- must match object graph -->
</metadata-record>
```

### RFM analysis calculated fields (example)

For RFM scoring on a datasource with `[Account Name]`, `[Close Date]`, `[Stage]`, `[Opportunity ID]`, `[Amount]`:

```xml
<!-- Base values (LOD per account, closed-won only) -->
<column caption='RFM: Recency (Days Since Last Won)' datatype='integer' name='[rfm_recency_days]' role='measure' type='quantitative'>
  <calculation class='tableau' formula='DATEDIFF(&apos;day&apos;, {FIXED [Account Name]: MAX(IF [Stage] = &apos;Closed Won&apos; THEN [Close Date] END)}, TODAY())' />
</column>
<column caption='RFM: Frequency (Won Deals)' datatype='integer' name='[rfm_frequency]' role='measure' type='quantitative'>
  <calculation class='tableau' formula='{FIXED [Account Name]: COUNTD(IF [Stage] = &apos;Closed Won&apos; THEN [Opportunity ID] END)}' />
</column>
<column caption='RFM: Monetary (Won Revenue)' datatype='real' name='[rfm_monetary]' role='measure' type='quantitative'>
  <calculation class='tableau' formula='{FIXED [Account Name]: SUM(IF [Stage] = &apos;Closed Won&apos; THEN [Amount] ELSE 0 END)}' />
</column>

<!-- Scores 1-5 using range mapping (R: lower days = higher score) -->
<column caption='RFM: R Score (1-5)' datatype='integer' name='[rfm_r_score]' role='measure' type='quantitative'>
  <calculation class='tableau' formula='INT(5.0 - 4.0 * ([rfm_recency_days] - {FIXED: MIN([rfm_recency_days])}) / NULLIF(FLOAT({FIXED: MAX([rfm_recency_days])} - {FIXED: MIN([rfm_recency_days])}), 0))' />
</column>
<column caption='RFM: F Score (1-5)' datatype='integer' name='[rfm_f_score]' role='measure' type='quantitative'>
  <calculation class='tableau' formula='INT(1.0 + 4.0 * ([rfm_frequency] - {FIXED: MIN([rfm_frequency])}) / NULLIF(FLOAT({FIXED: MAX([rfm_frequency])} - {FIXED: MIN([rfm_frequency])}), 0))' />
</column>
<column caption='RFM: M Score (1-5)' datatype='integer' name='[rfm_m_score]' role='measure' type='quantitative'>
  <calculation class='tableau' formula='INT(1.0 + 4.0 * ([rfm_monetary] - {FIXED: MIN([rfm_monetary])}) / NULLIF(FLOAT({FIXED: MAX([rfm_monetary])} - {FIXED: MIN([rfm_monetary])}), 0))' />
</column>

<!-- Combined score string and segment label -->
<column caption='RFM: Combined Score' datatype='string' name='[rfm_combined_score]' role='dimension' type='nominal'>
  <calculation class='tableau' formula='STR([rfm_r_score]) + STR([rfm_f_score]) + STR([rfm_m_score])' />
</column>
<column caption='RFM: Segment' datatype='string' name='[rfm_segment]' role='dimension' type='nominal'>
  <calculation class='tableau' formula='IF [rfm_r_score] &gt;= 4 AND [rfm_f_score] &gt;= 4 AND [rfm_m_score] &gt;= 4 THEN &quot;Champions&quot;
ELSEIF [rfm_r_score] &lt;= 2 AND [rfm_f_score] &gt;= 3 AND [rfm_m_score] &gt;= 3 THEN &quot;At Risk&quot;
ELSEIF [rfm_r_score] &lt;= 2 AND [rfm_f_score] &lt;= 2 THEN &quot;Churned&quot;
ELSEIF [rfm_r_score] &gt;= 4 AND [rfm_f_score] &lt;= 2 THEN &quot;Promising&quot;
ELSEIF [rfm_r_score] &lt;= 2 AND [rfm_m_score] &gt;= 4 THEN &quot;Can&apos;t Lose Them&quot;
ELSEIF [rfm_r_score] &gt;= 3 AND [rfm_f_score] &gt;= 3 THEN &quot;Loyal Customers&quot;
ELSEIF [rfm_r_score] &gt;= 3 AND [rfm_m_score] &gt;= 3 THEN &quot;High Value&quot;
ELSE &quot;Needs Attention&quot;
END' />
</column>
```

**Scoring formula notes:**
- `{FIXED: MIN([rfm_recency_days])}` — a table-scoped FIXED LOD that references another FIXED LOD. Tableau evaluates the inner LOD first. This pattern works.
- R score inverts (5 = most recent = fewest days): `5 - 4 * (value - min) / range`
- F and M scores are direct (5 = highest): `1 + 4 * (value - min) / range`
- `NULLIF(..., 0)` guards against divide-by-zero when all accounts have the same value

---

## Best Practices

- **Never modify `connection` or `named-connections` nodes** in an existing datasource: These contain file paths and authentication details for the live data connection.
- **Use `list-available-fields` to find datasource IDs**: After injection or when building a new worksheet, call this tool to get the current datasource names (`federated.XXXX`) — never guess them.
- **Set `caption` for readability**: The `caption` attribute controls the display name shown in Tableau's Data pane.
- **Set descriptions for generated fields**: Carry forward source metadata comments when available; otherwise add high-confidence descriptions that explain meaning, calculation, source, and appropriate use.
- **Keep identifiers as dimensions**: Numeric IDs and keys are non-additive dimensions unless the user explicitly asks for a generated measure such as `COUNTD([Match ID])`.
- **Strip `source-platform` and `xmlns:user` attrs**: These attrs from `.tds` files cause load errors when present in the workbook XML.
- **Remove `document-format-change-manifest`**: Not valid inside a datasource node (belongs at workbook root).
- **For multi-table datasources, always include `<object-id>` in metadata-records**: Without it, columns bind to the wrong logical table.
- **Tableau auto-discovers columns on load**: You don't need every column in the minimal definition — Tableau will infer the rest from the database schema. But `metadata-records` help Tableau set correct types.
- **Use `mode=file` for large workbooks**: The Agent API has a ~1 MB POST body limit. Native multi-table datasources with many columns can push the workbook past this limit.

---

## Common Mistakes

1. **Using `<relation type='text'>` (custom SQL) when native tables would work**: Custom SQL blocks Tableau's query optimizer, hides the data model from users, and prevents relationship-based joins. Use native tables with `<object-graph>` relationships.
2. **Omitting `<object-id>` in metadata-records for multi-table datasources**: Causes columns to bind to the wrong logical table.
3. **Omitting the `<object-graph>` entirely**: Without it, Tableau doesn't know about the logical model and tables appear disconnected.
4. **Re-using a stale file path**: After each `apply-workbook`, call `get-workbook-xml` immediately before any further modification.
5. **Not patching `dbname` for extracted `.hyper` files**: The `.tds` file contains the original file path which may not exist on the current machine.
6. **Injecting a published datasource (sqlproxy) programmatically**: Not supported — requires user action (Data > New Data Source > On a Server).
7. **Placing `<column>` elements after `<object-graph>`**: Tableau silently ignores them. They must appear before `<semantic-values>` and `<object-graph>`.

---

## Implementation

### Refactoring custom SQL to native tables

1. Call `get-workbook-xml(mode=file)` to get the current workbook XML.
2. Read the custom SQL from `<relation type='text'><![CDATA[...]]>` to identify tables, joins, and computed columns.
3. Build a new `<datasource>` node with:
   - `<connection class='federated'>` wrapping a `<named-connection>` to the database
   - `<relation type='collection'>` containing one `<relation type='table'>` per physical table
   - `<metadata-records>` with one record per column, each with correct `<object-id>`
   - `<object-graph>` with `<objects>` and `<relationships>` defining joins
4. Add `<column>` elements with `<calculation>` for any SQL-computed columns (aggregations → LOD expressions, CASE → IF/THEN).
5. Insert the new datasource into the workbook's `<datasources>` node.
6. Write to a cache file and submit via `apply-workbook(mode=file)`.
7. Verify with `list-available-fields` and build validation worksheets.

### Injecting a local `.tdsx` datasource

1. Unzip the `.tdsx` to extract the `.tds` XML and `.hyper` file(s).
2. Parse the `.tds` directly with `xml.etree.ElementTree`.
3. Apply transformations: delete `source-platform`/`xmlns:user`, set `caption`, patch `dbname`, remove `document-format-change-manifest`.
4. Insert into the workbook's `<datasources>` node.
5. Write to cache file and submit via `apply-workbook(mode=file)`.
6. Call `list-available-fields` to verify.

---

## Limitations and open questions

- **Published datasources (sqlproxy):** Programmatic injection of a published datasource connection has not been confirmed. The `list_published_datasources` tool can discover them, but connecting requires user action.
- **Field enumeration:** After injection, individual field metadata is visible in Tableau's UI but `list-available-fields` may not enumerate all fields until a worksheet uses the datasource.
- **NTILE / window functions:** Tableau has no direct equivalent of SQL `NTILE()`. Use rank-based range mapping with `{FIXED: MIN/MAX}` to approximate quintile scoring.
- **Temp paths:** Extracted `.hyper` file paths are temporary — if `/tmp` is cleared, the connection breaks.

## Source and Confidence

- Source/evidence type: field-tested
- Source: Live get-workbook-xml / apply-workbook round-trip capture
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-07-03
