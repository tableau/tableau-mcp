---
sidebar_position: 20
---

# List Datasource Logical Tables

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

List a datasource's logical tables (id + caption), the input to get-datasource-underlying-data.

## APIs called

Talks to the open %product_name% workbook through the External Client API.

- List a datasource's logical tables (id + caption), the input to get-datasource-underlying-data.

## Required arguments

### `datasourceName`

Datasource name/id.

:::note
A name or id that matches more than one datasource is refused because that datasource matched multiple datasources. Specify one id: each match is its caption, or its name when it has no caption, and its inventory id. A value that matches nothing is refused because that datasource was not found. Available datasources: the same caption-or-name and inventory id list.

- `Datasource "<name>" matched multiple datasources. Specify one id: <caption (id), ...>`
- `Datasource "<name>" was not found. Available datasources: <caption (id), ...>`
:::

## Optional arguments

### `session`

Session ID; optional if pinned or unique.
