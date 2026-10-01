---
sidebar_position: 3
---

# Get Workbook XML

Gets the XML for the workbook currently open in Tableau Desktop.

## Required arguments

### `session`

The Tableau Desktop session ID returned by [List Instances](list-instances.md).

## Optional arguments

### `mode`

- `file` (default): writes the workbook XML to the server's Desktop cache and returns its path in
  `file`. This is recommended for large workbooks.
- `inline`: returns the complete XML in `workbookXml`.

Use [Apply Workbook](apply-workbook.md) to load a modified workbook back into Tableau Desktop.
