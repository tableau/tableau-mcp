---
sidebar_position: 19
---

# Get Datasource Underlying Data

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Read raw row-level data for one of a datasource's logical tables (see list-datasource-logical-tables), independent of any worksheet.

## APIs called

Talks to the open %product_name% workbook through the External Client API.

- Read raw row-level data for one of a datasource's logical tables (see list-datasource-logical-tables), independent of any worksheet.

## Required arguments

### `datasourceName`

Datasource name, caption, or inventory id (from `get-datasources`).

:::note
A name or id that matches more than one datasource is refused because that datasource matched multiple datasources. Specify one id: each match is its caption, or its name when it has no caption, and its inventory id. A value that matches nothing is refused because that datasource was not found. Available datasources: the same caption-or-name and inventory id list.

- `Datasource "<name>" matched multiple datasources. Specify one id: <caption (id), ...>`
- `Datasource "<name>" was not found. Available datasources: <caption (id), ...>`
:::

### `logicalTable`

A logical table caption or id from the datasource's logical tables.

## Optional arguments

### `session`

Session ID; optional if pinned or unique.

### `maxRows`

Maximum number of rows to return. Defaults to 200. Values above 1000 are clamped to 1000.

### `columns`

Source column names to restrict the columns (e.g. "Region"). Bare names are qualified as `[datasource].[field]` against this datasource (internal name on API 0.2.25 and later, caption before that); a value already in that form is passed through.
