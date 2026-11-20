---
sidebar_position: 20
---

# Close Workbook

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Close the open workbook (File > Close). A workbook with no unsaved changes, or an empty untitled one, closes headlessly. Otherwise Desktop shows its native save prompt and blocks until a person responds: declining closes without saving, saving writes the workbook first, and cancelling leaves it open. Call save-workbook first to close without a prompt.

## APIs called

Talks to the open %product_name% workbook through the External Client API.

- Close the open workbook (File > Close).

## Optional arguments

### `session`

Session ID; optional if pinned or unique.
