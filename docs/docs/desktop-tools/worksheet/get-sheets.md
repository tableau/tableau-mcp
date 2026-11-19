---
sidebar_position: 11
---

# Get Sheets

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Read the sheets in the open workbook.

- Omit `kind` to get the workbook title, whether it has unsaved changes, and every sheet.
- Pass `kind` alone to list that kind's sheets, each with `id`, `name`, and `state`.
- Pass `kind` and `sheetId` to read that one sheet.

`index` is the 0-based tab position across all kinds, not the order of one kind's list. A worksheet's datasource list contains its references. An empty list does not mean the workbook has no connected datasource. Use [`get-datasources`](../data-source/get-datasources.md) when connection inventory matters. This tool is not needed before template discovery or building.

## APIs called

This tool reads the workbook open in the running %product_name% instance through the local **%product_name% %ecapi_name%**. There are no OAuth scopes.

- With no `kind`, reads the workbook inventory: title, unsaved changes, and every sheet.
- With `kind` and no `sheetId`, lists worksheets, dashboards, or storyboards.
- With `kind` and `sheetId`, resolves the name or id and reads that sheet.

## Optional arguments

### `session`

Session ID. Optional when a session is pinned or only one %product_name% instance is connected.

#### Example

`"12345"`

<hr />

### `kind`

Kind to list or read. Omit it to return every sheet. One of `worksheet`, `dashboard`, or `storyboard`.

#### Example

`"worksheet"`

:::note
`kind` is required when `sheetId` is set. The tool refuses with `kind is required with sheetId.`
:::

<hr />

### `sheetId`

Id of one sheet to read. A unique sheet name also works. Requires `kind`. Omit it to list that kind.

#### Example

`"Sales by Region"`

## Notes and caveats

- Every sheet includes `id` and `name`. Other fields appear only when the running %product_name% instance reports them. A fallback read may recover only id and name.
- When the workbook has no sheets of a kind, that list is an empty array.
- Pass `id` rather than `name` when two sheets share a display name. `index` is the tab position across every kind, not the order of one kind's list.
- This read does not return a sheet's structure. Use [`get-xml`](../workbook/get-xml.md) for that.

## Related

- [`get-datasources`](../data-source/get-datasources.md) — lists workbook datasources, including ones no sheet uses.
- [`get-xml`](../workbook/get-xml.md) — reads the live structure of the workbook or one existing sheet.
