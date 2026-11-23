---
sidebar_position: 1
---

# Delete Sheet

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Deletes a worksheet, dashboard, or storyboard from the workbook open in %product_name%, matching the target by name or id. The sheet and its window are both removed.

:::warning[Destructive]
This tool is not read-only and not idempotent. It removes a sheet from the live %product_name% workbook, so repeating the call is not a no-op: a second call for the same sheet is refused because that sheet is already gone.
:::

## APIs called

This tool acts on the workbook open in the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Reads the worksheet, dashboard, and storyboard inventories of the open workbook so the requested name or id can be matched to one sheet. Requires a connected %product_name% session with an open workbook; authorized by that session's loopback bearer token.
  - `GET /v<x>/workbook/worksheets` — list the worksheets in the open workbook. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
  - `GET /v<x>/workbook/dashboards` — list the dashboards in the open workbook. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/listDashboards)
  - `GET /v<x>/workbook/storyboards` — list the storyboards in the open workbook. [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/listStoryboards)
- Matches the request to one sheet and refuses deleting the last remaining worksheet. Validated in-process (not an API call). When that check refuses, nothing is posted.
- Deletes the matched sheet and its window. Issued only after the last-worksheet check passes. Requires a connected %product_name% session; authorized by that session's loopback bearer token. The request carries no body.
  - `POST /v<x>/workbook/worksheets/{id}:delete` — delete a worksheet. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/deleteWorksheet)
  - `POST /v<x>/workbook/dashboards/{id}:delete` — delete a dashboard. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/deleteDashboard)
  - `POST /v<x>/workbook/storyboards/{id}:delete` — delete a storyboard. [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/deleteStoryboard)

## Required arguments

### `sheet`
Name or id of the worksheet, dashboard, or storyboard to delete. Type: string. The tool matches against the live inventories of all three kinds after trimming whitespace: an exact id match wins; otherwise an exact, case-sensitive name match. A name that matches more than one sheet — including the same caption on a worksheet and a dashboard — is refused, and the tool asks you to pass an id. A name or id that matches nothing is refused with the sheets that are available, each listed as `name (id)`.

#### Example

```json
{ "sheet": "Sales by Region" }
```

:::note[Last remaining worksheet]
Tableau workbooks must keep at least one worksheet. If the matched sheet is a worksheet and it is the only worksheet in the workbook, the tool returns `deleted: false` with a message and deletes nothing — dashboards and storyboards in the same workbook are left as they are. Create another worksheet first, then delete this one. The last remaining dashboard or storyboard is not held to this rule and can be deleted.
:::

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

## Notes and caveats

- **`deleted` is true only when the deletion has completed.** The result also includes `sheet` (`id`, `kind`, and `name` as it was before the call) and a `message`. When %product_name% accepts the request before the change has settled, `deleted` is `false` and the message says the deletion was requested and is still being applied, rather than claiming it finished.

## Example results

### Deleted a worksheet

```json
{
  "deleted": true,
  "sheet": { "id": "sheet-sales", "kind": "worksheet", "name": "Sales by Region" },
  "message": "Deleted worksheet \"Sales by Region\"."
}
```

### Deleted a dashboard

```json
{
  "deleted": true,
  "sheet": { "id": "dash-exec", "kind": "dashboard", "name": "Executive Dashboard" },
  "message": "Deleted dashboard \"Executive Dashboard\"."
}
```

### Deleted a storyboard

```json
{
  "deleted": true,
  "sheet": { "id": "story-qbr", "kind": "storyboard", "name": "QBR Story" },
  "message": "Deleted storyboard \"QBR Story\"."
}
```

### Last remaining worksheet refused

```json
{
  "deleted": false,
  "sheet": { "id": "sheet-sales", "kind": "worksheet", "name": "Sales by Region" },
  "message": "Refused: \"Sales by Region\" is the only worksheet in the workbook and Tableau workbooks must keep at least one. Create another worksheet first, then delete this one. Nothing was deleted."
}
```

### Accepted, still being applied

```json
{
  "deleted": false,
  "sheet": { "id": "sheet-sales", "kind": "worksheet", "name": "Sales by Region" },
  "message": "Requested deletion of worksheet \"Sales by Region\"; Desktop is still applying it."
}
```

## Related

- [`rename-sheet`](./rename-sheet.md) — renames a worksheet, dashboard, or storyboard instead of deleting it.
- `get-sheets` — lists the sheets in the open workbook, so you can pick a valid sheet to delete.
- [`activate-sheet`](./activate-sheet.md) — brings a remaining worksheet or dashboard to the foreground after a delete.
