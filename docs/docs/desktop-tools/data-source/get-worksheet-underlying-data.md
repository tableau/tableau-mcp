---
sidebar_position: 1
---

# Get Worksheet Underlying Data

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Reads row-level underlying data for one of a worksheet's logical tables in the workbook open in the connected %product_name% instance — the table's rows, not the aggregated summary of the view. Choose the worksheet with `worksheet` (name or id) and the table with `logicalTable` (caption or id); a worksheet can expose more than one logical table, and this tool reads one table per call (`list-worksheet-logical-tables` lists them). This is a read-only operation that makes no changes to the workbook.

## APIs called

This tool reads from the workbook open in the running %product_name% instance, not the Tableau Cloud or Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. Because this API is local rather than a cloud service, it uses **no OAuth scopes**; each call is authorized instead by the running %product_name% instance's **per-session bearer token over the loopback interface**. A workbook must be open in the resolved %product_name% session.

- Reads the worksheet inventory of the open workbook to resolve the target worksheet by name or id. Authorized by the session's loopback bearer token; requires a workbook to be open in the session.
  - `GET /v<x>/workbook/worksheets` — list the worksheets in the open workbook. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
- Reads the logical tables of the resolved worksheet to resolve the target table by caption or id. Authorized by the session's loopback bearer token.
  - `GET /v<x>/workbook/worksheets/{id}/logicalTables` — list the worksheet's logical tables. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheetLogicalTables)
- When `columns` is supplied, reads the worksheet document so bare field names can be qualified against the worksheet's datasource. Authorized by the session's loopback bearer token.
  - `GET /v<x>/workbook/worksheets/{id}/document` — read the worksheet document. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetDocument)
- Reads the row-level underlying data for the resolved logical table, honoring the row cap and optional column selection. Authorized by the session's loopback bearer token.
  - `GET /v<x>/workbook/worksheets/{id}/logicalTables/{logicalTableId}/data` — read the logical table's underlying data. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetUnderlyingData)

## Required arguments

### `worksheet`

Name or id of the worksheet to read.

#### Example

`"Sales by Region"`

#### Worksheet resolution

If the value matches no worksheet, the tool returns an error listing the available worksheet names and ids. If the value matches more than one worksheet by name, the tool returns an error listing the matching worksheets so the ambiguity can be resolved (for example, by passing the worksheet's id instead of its name).

<hr />

### `logicalTable`
Caption or id of one logical table from the worksheet's logical tables. A worksheet can expose more than one logical table; pass a single caption or id per call.

#### Example

`"Orders"`

#### Logical table resolution

If the value matches no logical table, the tool returns an error listing the available table captions and ids. If the value matches more than one table by caption, the tool returns an error listing the matching tables so the ambiguity can be resolved (for example, by passing the table's id instead of its caption).

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

<hr />

### `maxRows`

Maximum number of rows to return. A positive integer. Defaults to `200`, and values above the cap are clamped to `1000` before the data is read. `Range: 1-1000`.

#### Example

`50`

<hr />

### `includeAllColumns`
When `true`, include every column of the logical table, not only the columns the view references. When omitted, this flag is not sent and the instance returns the columns the view references.

#### Example

`true`

<hr />

### `columns`
List of field names to restrict the returned columns (for example `"Region"`). When omitted, the instance returns the columns implied by `includeAllColumns`.

#### Example

```json
{ "columns": ["Region", "Sales"] }
```

#### Field-name qualification

Bare field names are qualified with the worksheet's datasource internal name (its caption on builds before API 0.2.25) before the data is read, as `[datasource].[field]` (for example `[federated.0abc123].[Region]`). A value already in `[datasource].[field]` form is passed through unchanged. Qualifying the names is done in-process (not an API call) after the worksheet document is read. If the worksheet declares no datasource, the call is refused. If the worksheet uses more than one datasource, a bare name is ambiguous and the call is refused — pass the field as `[datasource].[field]`.

:::note
When a name cannot be qualified, the tool refuses before reading the data. The message starts with "Cannot restrict columns:" and then the reason. One reason is that the worksheet declares no datasource to qualify the field name against. The other is that the worksheet uses multiple datasources, so the field name is ambiguous, and the message lists the datasource-qualified names to pass.

- `Cannot restrict columns: <reason>.`
:::

## Example result

### Underlying data for a resolved logical table (`worksheet: "Sales by Region"`, `logicalTable: "Orders"`, `maxRows: 50`)

```json
{
  "columns": [
    { "name": "Region", "dataType": "string" },
    { "name": "Sales", "dataType": "real" },
    { "name": "Profit", "dataType": "real" }
  ],
  "rows": [
    ["West", 1200, 240],
    ["East", 900, 120]
  ]
}
```

## Related

- [`list-worksheet-logical-tables`](./list-worksheet-logical-tables.md) — lists the logical tables (id and caption) this tool reads from.
- [`get-summary-data`](./get-summary-data.md) — reads the aggregated summary data of the view rather than row-level underlying data for one logical table.
