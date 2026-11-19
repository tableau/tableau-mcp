---
sidebar_position: 8
---

# Set Member Colors

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Set colors for members of the discrete field on a worksheet's Color.

## APIs called

This tool acts on the workbook open in the local %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface. Needs API version 0.2.10 or later.

- Reads the worksheet to find the field on Color.
  - `GET /v<x>/workbook/worksheets` — resolve the worksheet name to an id. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
  - `GET /v<x>/workbook/worksheets/{id}/document` — read the worksheet XML. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetDocument)
- Finds the datasource that owns the field.
  - `GET /v<x>/workbook/datasources` — list the workbook's datasources. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/listWorkbookDatasources)
- For a string field, reads the sheet's data so each member can be checked against real values. Skipped for a boolean field.
  - `GET /v<x>/workbook/worksheets` — list worksheets to resolve the worksheet id. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
  - `GET /v<x>/workbook/worksheets/{id}/summaryData` — read up to 10,000 rows of summary data. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/getWorksheetSummaryData)
- Reads the datasource, edits its color map in-process, then reads it again just before the write. If the second read differs from the first, nothing is written.
  - `GET /v<x>/workbook/datasources/{id}/document` — read the datasource XML (twice). [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getDatasourceDocument)
- Writes the edited datasource.
  - `POST /v<x>/workbook/datasources/{id}/document` — apply the datasource XML. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/applyDatasourceDocument)
- Reads the datasource back until the color map matches, to confirm the colors landed.
  - `GET /v<x>/workbook/datasources/{id}/document` — read the datasource XML back. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getDatasourceDocument)

## Required arguments

### `worksheetName`

Worksheet name or id. The sheet must have exactly one discrete string or boolean field on Color.

#### Example

`"Sales by Region"`

<hr />

### `colors`

The members to color and the color for each: an array of 1 to 100 `{ member, color }` entries.

- `member` — the member value as it appears in the data, or one of its aliases. For a boolean field, use `true` or `false`.
- `color` — a hex color in the form `#rrggbb`.

#### Example

```json
{
  "colors": [
    { "member": "East", "color": "#4e79a7" },
    { "member": "West", "color": "#f28e2b" }
  ]
}
```

:::note[Refusals]
Each entry is checked before anything is written.

- `Color "<color>" for "<member>" must be #rrggbb.`
- `Member "<member>" is not valid for a boolean field; use true or false.`
- `Member "<member>" is listed more than once.`
- `<members> is not in this sheet's data, so nothing was changed. Members in the data: <values>. A member filtered out of this sheet can be colored from a sheet that shows it.`
:::

## Optional arguments

### `session`

The %product_name% session to target (Desktop PID). Omit it when the session is pinned or exactly one %product_name% instance is running.

#### Example

`"12345"`

<hr />

### `field`

Name or caption of the field on Color. Needed only when the sheet's panes color by different fields.

#### Example

`"Region"`

## Notes and caveats

- The color field's datasource must already be in the workbook. If it is not, the tool refuses with `Datasource "name" is not in the workbook`, where `name` is the datasource resolved from the Color encoding.
- **The datasource must not change during the call.** If another edit lands between the first read and the write, the tool refuses with `The datasource changed during the call, so nothing was applied. The call is safe to repeat.`
- **The colors are confirmed by a readback.** If %product_name% accepts the write but the readback does not match, the tool refuses with `Desktop accepted the change but the datasource readback does not match. <detail> The call is safe to repeat. If it fails again, tell the user the colors could not be set.` If the datasource cannot be read back at all, it refuses with `Sent the colors for <members> but could not read the datasource back, so they are not confirmed. Do not tell the user these colors are set.` followed by the same retry advice.

## Example result

```json
{
  "message": "Set 2 member color(s) for Region in datasource federated.0abc123: East -> #4e79a7; West -> #f28e2b. Read back the datasource document: every requested member color matched.",
  "field": "Region",
  "datasource": "federated.0abc123",
  "colors": [
    { "member": "East", "color": "#4e79a7" },
    { "member": "West", "color": "#f28e2b" }
  ]
}
```
