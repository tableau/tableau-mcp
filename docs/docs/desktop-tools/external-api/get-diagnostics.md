---
sidebar_position: 2
---

# Get Workbook Diagnostics

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Inspect the existing workbook before editing. Use diagnostics returned by supported workbook and worksheet document edits instead of a second read for the same result. Static diagnostics do not verify query execution or rendering.

## APIs called

Talks to the open %product_name% workbook through the External Client API.

- Inspect the existing workbook before editing.

## Optional arguments

### `session`

Session ID; optional if pinned or unique.

### `worksheetName`

Worksheet name or stable id; omit for diagnostics for the entire workbook.
