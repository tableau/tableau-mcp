---
sidebar_position: 13
---

# List Worksheet Logical Tables

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Lists the logical tables of one worksheet in the workbook open in the connected %product_name% instance, returning each table's `id` and `caption` — the identifiers you pass when reading that worksheet's row-level underlying data with `get-worksheet-underlying-data`. Choose the worksheet with `worksheet`, giving either its name or its id. This is a read-only operation that makes no changes to the workbook.

## APIs called

This tool reads from the workbook open in the running %product_name% instance, not the Tableau Cloud or Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. Because this API is local rather than a cloud service, it uses **no OAuth scopes**; each call is authorized instead by the running %product_name% instance's **per-session bearer token over the loopback interface**. A workbook must be open in the resolved %product_name% session.

- Reads the worksheet inventory of the open workbook to resolve the target worksheet by name or id. Authorized by the session's loopback bearer token; requires a workbook to be open in the session.
  - `GET /v<x>/workbook/worksheets` — list the worksheets in the open workbook. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
- Reads the logical tables available for that worksheet's underlying data, returning each table's id and caption. Authorized by the session's loopback bearer token.
  - `GET /v<x>/workbook/worksheets/{id}/logicalTables` — list the worksheet's logical tables. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheetLogicalTables)

## Required arguments

### `worksheet`

Name or id of the worksheet whose logical tables to list. A string. The worksheet must exist in the open workbook.

#### Example

```json
{ "worksheet": "Sales by Region" }
```

#### Worksheet resolution

If the value matches no worksheet, the tool returns an error listing the available worksheet names and ids. If the value matches more than one worksheet by name, the tool returns an error listing the matching worksheets so the ambiguity can be resolved (for example, by passing the worksheet's id instead of its name).

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected or a session has been pinned).

#### Example

`"12345"`

## Notes and caveats

- **Id and caption.** Each table includes `id` and `caption` when the running instance reports them. A field that is not reported is omitted from that entry rather than returned empty.
- **Empty `tables` when the worksheet has none.** The tool returns `{ "tables": [] }` rather than an error.

## Example results

### Logical tables found (`worksheet: "Sales by Region"`)

```json
{
  "tables": [
    { "id": "lt-orders", "caption": "Orders" },
    { "id": "lt-returns", "caption": "Returns" }
  ]
}
```

### No logical tables

```json
{
  "tables": []
}
```

## Related

- [`get-worksheet-underlying-data`](./get-worksheet-underlying-data.md) — reads row-level rows from one of the listed logical tables.
- [`get-summary-data`](./get-summary-data.md) — reads the aggregated rows and columns on the worksheet's view, rather than listing the logical tables used for row-level underlying data.
