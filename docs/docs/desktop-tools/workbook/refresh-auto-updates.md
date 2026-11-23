---
sidebar_position: 18
---

# Refresh Auto Updates

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Run pending automatic updates now, without changing the active sheet: for one worksheet, every worksheet in a dashboard's current device layout, or the current point of a storyboard. Use after batching edits with `set-auto-updates-paused`. If a dashboard or storyboard worksheet fails, the error result reports a PARTIAL or FAILED outcome per worksheet.

## APIs called

This tool acts on the workbook open in the running %product_name% instance, not on the Tableau Cloud or Tableau Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. There are no OAuth scopes: each call is authorized by the running %product_name% instance's per-session bearer token over the loopback interface.

- Settles on which %product_name% session to target before anything is sent. Resolved in-process (not an API call).
- Asks %product_name% to run pending automatic updates on the sheet now, treating `sheetId` as an id first. The route depends on `kind`. Requires a connected %product_name% session; authorized by that session's loopback bearer token. The request carries no body.
  - `POST /v<x>/workbook/worksheets/{id}:refreshNow` — run pending automatic updates on a worksheet now. _[API reference link TBD]_
  - `POST /v<x>/workbook/dashboards/{id}:refreshNow` — run pending automatic updates on every worksheet in a dashboard's current device layout. _[API reference link TBD]_
  - `POST /v<x>/workbook/storyboards/{id}:refreshNow` — run pending automatic updates on the current point of a storyboard. _[API reference link TBD]_
- Only if %product_name% reports that no sheet has that id, reads the inventory for the given `kind` so the requested name can be matched to one sheet, then sends the refresh again with the matched id. Requires a connected %product_name% session with an open workbook; authorized by that session's loopback bearer token.
  - `GET /v<x>/workbook/worksheets` — list the worksheets in the open workbook. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
  - `GET /v<x>/workbook/dashboards` — list the dashboards in the open workbook. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/listDashboards)
  - `GET /v<x>/workbook/storyboards` — list the storyboards in the open workbook. [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/listStoryboards)

## Required arguments

### `sheetId`
Id of the sheet whose pending updates should run now (_available November 2026 and later_). A unique sheet name also works. Type: string.

#### Example

```json
{ "sheetId": "Sales by Region" }
```

<hr />

### `kind`
Which kind of sheet `sheetId` is (_available November 2026 and later_). Type: enum. One of `worksheet`, `dashboard`, or `storyboard`.

#### Example

`"worksheet"`

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"12345"`

:::note[Session resolution does not guess]
With no `session` given and no %product_name% instance running, or more than one running, the tool reports an error rather than picking one; the multiple-instance error lists the session IDs to choose from. A `session` that names an instance which is not among the running ones is refused the same way.
:::

## Notes and caveats

- **For a worksheet, `refreshed` is true only when the refresh has completed.** The result also includes `sheet` (`id` and `kind`) and a `message`. When %product_name% accepts the request before the change has settled, `refreshed` is `false` and the message says the refresh was requested and is still being applied, rather than claiming it finished.
- **Not read-only, and not idempotent.** The tool asks %product_name% to run pending automatic updates now, so it is not a read-only operation and repeating the call can start another refresh.

## Example results

### Refreshed a worksheet

```json
{
  "refreshed": true,
  "sheet": { "id": "sheet-sales", "kind": "worksheet" },
  "message": "Refreshed auto-updates for worksheet \"sheet-sales\"."
}
```

### Accepted, still being applied

```json
{
  "refreshed": false,
  "sheet": { "id": "sheet-sales", "kind": "worksheet" },
  "message": "Requested refreshing auto-updates for worksheet \"sheet-sales\"; Desktop is still applying it."
}
```

## Related

- `set-auto-updates-paused` — pauses or resumes automatic query execution so you can batch edits before this refresh.
- `get-sheets` — lists the worksheets in the open workbook, including stable ids, so you can pick a valid target.
