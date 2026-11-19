---
sidebar_position: 17
---

# Get Structure

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Read the live structure of the open workbook, or of one existing sheet or datasource.

- Omit `kind` to read the whole workbook.
- `worksheet`, `dashboard`, or `storyboard` reads that sheet. `sheetId` is required.
- `datasource` reads that datasource. `datasourceId` is required.

`mode` `file` (the default) saves the structure to a cache file and returns its path. `mode` `inline` returns the content unless it exceeds the inline cap. A worksheet read resets that worksheet's edit buffer. For a draft, read the cached file instead.

## APIs called

This tool reads structure from the workbook open in the running %product_name% instance through the local **%product_name% %ecapi_name%**. There are no OAuth scopes. `mode` `file` also writes a cache file on this machine.

- With no `kind`, reads the workbook structure.
- With a sheet `kind`, reads that worksheet, dashboard, or storyboard.
- With `kind` `datasource`, reads that datasource's structure. A datasource document requires a recent enough %product_name% build.

## Optional arguments

### `session`

Session ID. Optional when a session is pinned or only one %product_name% instance is connected.

#### Example

`"studio-1"`

<hr />

### `kind`

What to read. Omit it for the whole workbook. One of `worksheet`, `dashboard`, `storyboard`, or `datasource`.

#### Example

`"worksheet"`

:::note
- `sheetId` is required with `kind` `worksheet`, `dashboard`, or `storyboard`. The refusal names the kind: `sheetId is required with kind worksheet.`
- `sheetId` does not apply to `kind` `datasource`.
- `datasourceId` is required with `kind` `datasource`, and is refused unless `kind` is `datasource`.
:::

<hr />

### `sheetId`

Sheet id or name, for a sheet kind.

#### Example

`"Sales by Region"`

:::note
`sheetId` requires `kind`. It does not apply when `kind` is `datasource`.
:::

<hr />

### `datasourceId`

Datasource id or name, for `kind` `datasource`.

#### Example

`"Sales"`

<hr />

### `mode`

`file` (default) saves the structure to a cache file and returns its path. `inline` returns the content unless it exceeds the inline cap.

#### Example

`"file"`

## Notes and caveats

- A worksheet read resets that worksheet's edit buffer. Read the cached file when the draft must be kept.
- Reading a worksheet that sits on a dashboard and has real data can fail with operation-failed (500). Do not read that worksheet's structure. Use [`list-available-fields`](../fields/list-available-fields.md) and the dashboard's structure instead.
- A storyboard is stored as a dashboard element marked as a storyboard. If the document has no storyboard subtree for the name you gave, the tool reports that and writes no cache file.
- The default `mode` writes a new cache file on each call.

## Related

- [`get-sheets`](../worksheet/get-sheets.md) — lists sheets and their ids before a structure read.
- [`read-cached-xml`](../cache/read-cached-xml.md) — reads a draft from the cache without resetting the edit buffer.
