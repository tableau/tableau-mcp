---
sidebar_position: 4
---

# Apply Workbook

Loads modified workbook XML into the selected Tableau Desktop instance. This updates the active
workbook and is destructive and non-idempotent.

## Required arguments

### `session`

The Tableau Desktop session ID returned by [List Instances](list-instances.md).

## Optional arguments

### `mode`

- `file` (default): reads the XML from `workbookFile`.
- `inline`: reads the XML from `workbookXml`.

### `workbookFile`

Path to a workbook cache file. Required when `mode` is `file`; normally this is the path returned by
[Get Workbook XML](get-workbook-xml.md).

### `workbookXml`

The complete TWB XML string. Required when `mode` is `inline`.
