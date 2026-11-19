---
sidebar_position: 10
---

# Show Me

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Apply a Show Me option. First call get-show-me-options, choose one marked applicable, and reuse its worksheet, data source, and selected fields.

## APIs called

Talks to the open %product_name% workbook through the External Client API.

- Apply a Show Me option.

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

- `dataSource "${}" was not found or is ambiguous. Candidates: ${}. Show Me was not called.`
:::

### `fieldsSelectedInSchemaViewer`

Same optional fields. Captions and [datasource caption].[field] resolve; omit if discovery did, [] selects none.

:::note
Show Me was not called when a selected field does not resolve. The refusal names that entry's index and the value you passed. The value uses a datasource qualifier that was not found or is ambiguous (candidates are caption and internal name), conflicts with `dataSource`, is ambiguous, was not found, or was not found in the resolved datasource. Field candidates, when listed, are caption and column reference, at most five.

- `fieldsSelectedInSchemaViewer[${}] "${}" ${}.${} Show Me was not called.`
:::
