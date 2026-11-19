---
sidebar_position: 10
---

# Show Me

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Apply a Show Me option. First call get-show-me-options, choose one marked applicable, and reuse its worksheet, data source, and selected fields.

## APIs called

This tool acts on a worksheet in the workbook open in the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Reads the worksheet inventory so the requested name or id can be matched to one worksheet.
  - `GET /v<x>/workbook/worksheets` — list the worksheets in the open workbook. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
- Reads the workbook document to resolve `dataSource` and `fieldsSelectedInSchemaViewer`, only when one of them is given. When either does not resolve, nothing further is sent.
  - `GET /v<x>/workbook/document` — retrieve the open workbook document. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/getWorkbookDocument)
- Asks %product_name% to apply the Show Me type to the matched worksheet.
  - `POST /v<x>/workbook/worksheets/{id}:showMe` (`Content-Type: application/json`) — apply the Show Me type. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/showMeWorksheet)

## Required arguments

### `worksheet`

Worksheet name or stable id.

### `showMeType`

Applicable showMeType returned by discovery.

## Optional arguments

### `session`

Session ID; optional if pinned or unique.

### `dataSource`

Same optional datasource name or caption.

:::note
The tool refuses, and Show Me was not called, when `dataSource` was not found or is ambiguous. Candidates: each workbook datasource as its caption and internal name.

- `dataSource "<dataSource>" was not found or is ambiguous. Candidates: <candidates>. Show Me was not called.`
:::

### `fieldsSelectedInSchemaViewer`

Same optional fields. Captions and [datasource caption].[field] resolve; omit if discovery did, [] selects none.

:::note
Show Me was not called when a selected field does not resolve. The refusal names that entry's index and the value you passed. The value uses a datasource qualifier that was not found or is ambiguous (candidates are caption and internal name), conflicts with `dataSource`, is ambiguous, was not found, or was not found in the resolved datasource. Field candidates, when listed, are caption and column reference, at most five.

- `fieldsSelectedInSchemaViewer[<index>] "<field>" <reason>. Candidates: <candidates>. Show Me was not called.`
:::

## Example result

```json
{
  "showMeRequested": true,
  "operationStatus": "completed",
  "worksheet": { "id": "sheet-sales", "name": "Sales by Region" },
  "showMeType": "bar-horiz",
  "message": "Desktop accepted Show Me type \"bar-horiz\" for worksheet \"Sales by Region\". The resulting visualization was not independently verified."
}
```
