---
sidebar_position: 11
---

# Rename Sheet

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Renames a worksheet, dashboard, or storyboard in the workbook open in %product_name%, matching the target by name or id. The sheet keeps its id and kind; only the display name changes.

:::note[Not read-only]
This tool is not read-only and not idempotent. It changes a sheet name in the live %product_name% workbook, so repeating the call is not a no-op: a second call that still uses the previous name is refused because that name is already gone.
:::

## APIs called

This tool acts on the workbook open in the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Reads the worksheet, dashboard, and storyboard inventories of the open workbook so the requested name or id can be matched to one sheet. Requires a connected %product_name% session with an open workbook; authorized by that session's loopback bearer token.
  - `GET /v<x>/workbook/worksheets` — list the worksheets in the open workbook. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
  - `GET /v<x>/workbook/dashboards` — list the dashboards in the open workbook. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/listDashboards)
  - `GET /v<x>/workbook/storyboards` — list the storyboards in the open workbook. [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/listStoryboards)
- Matches the request to one sheet. Validated in-process (not an API call). When that match refuses, nothing is posted.
- Renames the matched sheet. Issued only after the match succeeds. Requires a connected %product_name% session; authorized by that session's loopback bearer token. The request body is `{ "name": "<new name>" }`.
  - `POST /v<x>/workbook/worksheets/{id}:rename` — rename a worksheet. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/renameWorksheet)
  - `POST /v<x>/workbook/dashboards/{id}:rename` — rename a dashboard. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/renameDashboard)
  - `POST /v<x>/workbook/storyboards/{id}:rename` — rename a storyboard. [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/renameStoryboard)

## Required arguments

### `sheet`
Name or id of the worksheet, dashboard, or storyboard to rename. Type: string. The tool matches against the live inventories of all three kinds after trimming whitespace: an exact id match wins; otherwise an exact, case-sensitive name match. A name that matches more than one sheet — including the same caption on a worksheet and a dashboard — is refused, and the tool asks you to pass an id. A name or id that matches nothing is refused with the sheets that are available, each listed as `name (id)`.

#### Example

```json
{ "sheet": "Sales by Region" }
```

<hr />

### `name`

The new display name for the matched sheet. Type: string. Range: 1 or more characters. An empty string is refused.

#### Example

```json
{ "name": "Regional Sales" }
```

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"studio-1"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

## Notes and caveats

- **`sheet.name` in the result is the new name.** The result also includes `previousName` (what the sheet was called before this call), `sheet.id`, `sheet.kind`, and a `message`. When %product_name% accepts the request before the change has settled, the message says the rename was requested and is still being applied, rather than claiming it finished.

## Example results

### Renamed a worksheet

```json
{
  "sheet": { "id": "sheet-sales", "kind": "worksheet", "name": "Regional Sales" },
  "previousName": "Sales by Region",
  "message": "Renamed worksheet \"Sales by Region\" to \"Regional Sales\"."
}
```

### Renamed a dashboard

```json
{
  "sheet": { "id": "dash-exec", "kind": "dashboard", "name": "Exec Summary" },
  "previousName": "Executive Dashboard",
  "message": "Renamed dashboard \"Executive Dashboard\" to \"Exec Summary\"."
}
```

### Renamed a storyboard

```json
{
  "sheet": { "id": "story-qbr", "kind": "storyboard", "name": "QBR 2026" },
  "previousName": "QBR Story",
  "message": "Renamed storyboard \"QBR Story\" to \"QBR 2026\"."
}
```

### Accepted, still being applied

```json
{
  "sheet": { "id": "sheet-sales", "kind": "worksheet", "name": "Regional Sales" },
  "previousName": "Sales by Region",
  "message": "Requested rename to \"Regional Sales\"; Desktop is still applying it."
}
```

## Related

- [`activate-sheet`](./activate-sheet.md) — brings the renamed sheet to the foreground by name or id.
- `get-sheets` — lists every sheet in the open workbook, including stable ids, so you can pick a valid target.
