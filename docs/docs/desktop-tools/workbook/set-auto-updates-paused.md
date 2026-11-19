---
sidebar_position: 15
---

# Set Auto Updates Paused

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Pause or resume automatic query execution for a worksheet, or for a dashboard and every worksheet it contains. Pause to batch edits before the next refresh. Resuming a dashboard re-enables every worksheet it contains, not only ones paused earlier.

## APIs called

This tool changes automatic query execution on a worksheet or dashboard in the workbook open in the running %product_name% instance, through the local **%product_name% %ecapi_name%**. There are no OAuth scopes. Storyboards are not a target.

## Required arguments

### `sheetId`

Id of the worksheet or dashboard. A unique sheet name also works.

#### Example

```json
{ "sheetId": "Sales by Region" }
```

<hr />

### `kind`

Which kind of sheet `sheetId` is. One of `worksheet` or `dashboard`.

#### Example

`"dashboard"`

<hr />

### `isAutoUpdatesPaused`

`true` pauses automatic query execution. `false` resumes it.

#### Example

`true`

## Optional arguments

### `session`

Session ID. Optional when a session is pinned or only one %product_name% instance is connected.

#### Example

`"12345"`

## Notes and caveats

- The result includes `sheet` (`id`, `kind`, and `name` as they were before the call) and a `message`. It also has a `paused` key when pausing or a `resumed` key when resuming. That key is `true` only when the change has completed. When %product_name% accepts the request first, it is `false` and the message says the change is still being applied. Resuming a dashboard also adds `alsoResumedContainedWorksheets: true`.
- Pausing a sheet whose automatic updates are already paused, or resuming one that is already running, is safe to repeat. Resuming a dashboard re-enables every worksheet it contains, not only ones paused earlier.

## Example results

### Paused a worksheet

```json
{
  "paused": true,
  "sheet": { "id": "sheet-sales", "kind": "worksheet", "name": "Sales by Region" },
  "message": "Paused auto-updates for worksheet \"Sales by Region\"."
}
```

### Resumed a dashboard

```json
{
  "resumed": true,
  "sheet": { "id": "dash-exec", "kind": "dashboard", "name": "Executive Dashboard" },
  "alsoResumedContainedWorksheets": true,
  "message": "Resumed auto-updates for dashboard \"Executive Dashboard\" and every worksheet it contains."
}
```

## Related

- [`refresh-auto-updates`](refresh-auto-updates.md) — runs pending automatic updates after a batched edit.
- [`get-sheets`](../worksheet/get-sheets.md) — lists sheet ids to pass as `sheetId`.
