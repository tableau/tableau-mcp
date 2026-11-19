---
sidebar_position: 23
---

# Validate Calculated Field

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Check a new or edited calculated field against a datasource without changing the workbook. Returns isValid, errors (position, length, message), and if valid dataType and isAggregate.

## APIs called

Talks to the open %product_name% workbook through the External Client API.

- Check a new or edited calculated field against a datasource without changing the workbook.

## Required arguments

### `datasourceName`

Datasource name/id.datasource

:::note
A name or id that matches more than one datasource is refused because that datasource matched multiple datasources. Specify one id: each match is its caption, or its name when it has no caption, and its inventory id. A value that matches nothing is refused because that datasource was not found. Available datasources: the same caption-or-name and inventory id list.

- `Datasource "${}" matched multiple datasources. Specify one id: ${}`
- `Datasource "${}" was not found. Available datasources: ${}`
:::

### `formula`

Calculated field formula to check.

## Optional arguments

### `session`

Session ID; optional if pinned or unique.

### `caption`

Caption the field would have; duplicates are errors.

### `fieldName`

Internal name of the calc being edited, e.g. Calculation_123. Omit for a new field.
