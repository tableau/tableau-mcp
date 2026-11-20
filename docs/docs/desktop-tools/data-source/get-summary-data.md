---
sidebar_position: 8
---

# Get Summary Data

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Reads the aggregated summary rows on a populated worksheet in the workbook open in the connected %product_name% instance — only the fields on the view, not its chart specification. You choose the worksheet with `worksheetName`, giving either its name or its id, or omit it when the workbook has exactly one worksheet. This is the first thing to check when answering a data question or making an authoring choice: inspect the underlying rows before reasoning about charts, calculations, or filters. The result carries only the fields that are on the view, so a field must be added to the marks card (for example, to Detail) before it appears here. This is a read-only operation that makes no changes to the workbook.

## APIs called

This tool reads from the workbook open in the running %product_name% instance, not the Tableau Cloud or Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. Because this API is local rather than a cloud service, it uses **no OAuth scopes**; each call is authorized instead by the running %product_name% instance's **per-session bearer token over the loopback interface**. A workbook must be open in the resolved %product_name% session.

- Reads the worksheet inventory of the open workbook to resolve the target worksheet by name or id. Authorized by the session's loopback bearer token; requires a workbook to be open in the session.
  - `GET /v<x>/workbook/worksheets` — list the worksheets in the open workbook. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
- Reads the aggregated summary data (the rows and columns on the view) for the resolved worksheet, honoring the row cap and optional field selection. Authorized by the session's loopback bearer token.
  - `GET /v<x>/workbook/worksheets/{id}/summaryData` — read the worksheet's summary data. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetSummaryData)

## Optional arguments

Every argument is optional, including the worksheet selector: supply the worksheet with `worksheetName`, or with its deprecated alias `worksheet`, or with neither when the open workbook has exactly one worksheet.

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"studio-1"`

<hr />

### `worksheetName`

Name or id of the worksheet to read. When omitted, the worksheet is resolved automatically only if the open workbook has exactly one worksheet; otherwise the tool returns an error listing the available worksheets so a specific one can be chosen.

#### Example

`"Sales by Region"`

#### Worksheet resolution

If the value matches no worksheet, the tool returns an error listing the available worksheet names and ids. If the value matches more than one worksheet by name, the tool returns an error listing the matching worksheets so the ambiguity can be resolved (for example, by passing the worksheet's id instead of its name).

<hr />

### `worksheet`

Deprecated alias of `worksheetName`, kept working so existing callers do not break. It accepts exactly the same values — a name or an id — so it is not a second way of identifying the worksheet, just the older key for the same one. Prefer `worksheetName`. Supplying both is allowed only when the two are identical; if they disagree the call is refused with an error naming both values rather than picking one. Unlike the other tools that take this pair, supplying neither is legal here — that is the "omit when the workbook has exactly one worksheet" case described under [`worksheetName`](#worksheetname).

#### Example

`"Sales by Region"`

:::note
When no worksheet is named and the workbook has more than one, the tool refuses with `Multiple worksheets exist. Specify worksheet by name or id.` and lists the available worksheets as `name (id)`.
:::

<hr />

### `maxRows`

Maximum number of rows to return. A positive integer. Defaults to `200`, and values above the cap are clamped to `1000` before the data is read. `Range: 1-1000`. The tool reads one extra row to detect truncation; see `truncated` below.

#### Example

`50`

<hr />

### `columns`
List of field names to restrict the returned columns (for example `"Region"`). When omitted, all fields on the view are returned. Use exact column names this worksheet already returns.

#### Example

```json
{ "columns": ["Region", "Sales"] }
```

:::note
Each name has to match a column the worksheet returned. A name that matches more than one returned column is refused with `Requested summary column "<name>" matches more than one returned column: <columns>. Available columns: <columns>.` A name that was not returned is refused with `Requested summary column "<name>" was not returned by the worksheet. Available columns: <columns>.`

- `Requested summary column "${}" ${}. Available columns: ${}`
- `Requested summary column "${}" matches more than one returned column: ${}. Available columns: ${}`
:::

## Notes and caveats

- **Only fields on the view are carried.** The summary data contains just the fields present on the worksheet; a field that is not on the view (for example, one not yet added to Detail on the marks card) will not appear in the columns or rows. Add the field to the view first, then re-read.
- **`shape` is a convenience summary.** The result includes a `shape` string such as `"2 rows x 3 columns"` describing the returned `summaryData`; it reflects the rows actually returned after the `maxRows` cap and any `columns` selection are applied.
- **`truncated` says whether you saw every row.** It is `true` when more rows exist than were returned and `false` when every row was returned. It is `null` (unknown) when the API returned no rows although columns exist. `false` assumes the API's default 10000-row cap: a server configured with a lower cap can cut rows silently, and the tool cannot detect that.

## Example result

### Summary data for a resolved worksheet (`worksheetName: "Sales by Region"`, `maxRows: 50`, `columns: ["Region", "Sales"]`)

```json
{
  "worksheet": { "id": "sheet-sales", "name": "Sales by Region" },
  "maxRows": 50,
  "truncated": false,
  "shape": "2 rows x 3 columns",
  "summaryData": {
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
}
```

## Related

- `get-sheets` — lists the sheets in the open workbook, including which worksheets have data to summarize.
- [`list-worksheet-logical-tables`](./list-worksheet-logical-tables.md) — lists a worksheet's logical tables, the input to a row-level underlying-data read.
- [`get-worksheet-underlying-data`](./get-worksheet-underlying-data.md) — reads row-level rows from one of those logical tables.
- `get-datasources` — lists the datasources that belong to the open workbook.
