---
sidebar_position: 2
---

# Activate Sheet

{/* availability */}
<span className="toolAvailability">Available September 2026 and later.</span>
{/* /availability */}

Activates an existing worksheet, dashboard, or storyboard in the open %product_name% workbook, bringing it to the foreground so it becomes the active sheet (_available September 2026 and later_ for storyboards and for matching by id). The target is matched by exact name or by stable id against a fresh read of the live workbook before any navigation is issued, so a name or id that no longer exists is refused rather than acted on.

## APIs called

This tool acts on the workbook open in the running %product_name% instance, not the Tableau Cloud or Server REST API. Under the hood these are calls to the local **%product_name% %ecapi_name%** — a REST API the running %product_name% instance serves at `http://127.0.0.1:<port>/v<x>`, where `<x>` is the latest API version. These calls carry no OAuth scopes; each is authorized instead by the running instance's **per-session bearer token over the loopback interface**, so only a caller on the same machine that holds the session's token can issue them.

- Reads the current worksheets, dashboards, and storyboards in the open workbook so the requested name or id can be resolved. Requires a connected %product_name% session with an open workbook; authorized by that session's loopback bearer token.
  - `GET /v<x>/workbook/worksheets` — list the worksheets in the open workbook. [API reference](ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets)
  - `GET /v<x>/workbook/dashboards` — list the dashboards in the open workbook. [API reference](ext://eca/reference/index.html#tag/Dashboards/operation/listDashboards)
  - `GET /v<x>/workbook/storyboards` — list the storyboards in the open workbook. [API reference](ext://eca/reference/index.html#tag/Storyboards/operation/listStoryboards)
- Confirms the requested value against that combined list, matching an exact id first and otherwise an exact name. Validated in-process (not an API call).
- Asks %product_name% to focus the resolved sheet. Issued only after the match succeeds — if the sheet is absent from the fresh read, no navigation is sent. The request settles asynchronously, so the tool reports that focus was requested rather than that the sheet has already repainted.
  - `POST /v<x>/workbook:goToSheet` — request focus on the resolved sheet by id. [API reference](ext://eca/reference/index.html#tag/Workbook/operation/goToSheet)

## Required arguments

### `sheetName`
The exact, case-sensitive name or stable id of the worksheet, dashboard, or storyboard to make active (_available September 2026 and later_ for storyboards and for matching by id). The value must match a sheet present in the current workbook read; a name that differs by case, or a name or id that is not found, is refused, and the response lists the available sheet names so you can retry with a valid value.

#### Example

```json
{ "sheetName": "Sales by Region" }
```

## Optional arguments

### `session`
Identifier of the target %product_name% session. When omitted, the session is resolved automatically (for example, when exactly one %product_name% instance is connected).

#### Example

`"studio-1"`

## Notes and caveats

- **Exact, case-sensitive matching.** `"beta"` does not match a sheet named `"Beta"`. Matching covers worksheets, dashboards, and storyboards, by name or by id.
- **Not read-only, but idempotent.** The tool changes which sheet is active, so it is not a read-only operation; however, requesting focus on a sheet that is already active is safe to repeat.
- **`focus_requested` is the outcome, not a confirmed repaint.** The go-to-sheet call settles asynchronously, so a successful result means %product_name% was asked to focus that sheet. The result's `sheetName` is the resolved display name, even when you passed an id.

## Example results

### Focus requested (sheet found)

```json
{
  "focus_requested": true,
  "sheetName": "Beta",
  "message": "Requested focus on sheet \"Beta\".",
  "availableSheets": ["Alpha", "Beta"]
}
```

### Sheet not found

When the requested name or id is not present in the fresh workbook read, the tool reports an error and returns the available sheet names as structured content:

```json
{
  "availableSheets": ["Revenue \"Q1\"", "Profit, YoY"]
}
```

## Related

- `get-sheets` — lists every sheet in the open workbook, including stable ids, so you can pick a valid target.
- `get-xml` — reads the structure of the open workbook, including which sheet is currently active.
