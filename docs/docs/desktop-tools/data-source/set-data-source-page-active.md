---
sidebar_position: 22
---

# Set Data Source Page Active

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Switch %product_name% to the Data Source page or back to a sheet, and return the page state read back. The request can succeed without changing the page, for example when a published datasource cannot connect.

## APIs called

Talks to the open %product_name% workbook through the External Client API.

- Switch %product_name% to the Data Source page or back to a sheet, and return the page state read back.

## Required arguments

### `isDataSourcePageActive`

True to switch %product_name% to the Data Source page, false to switch back to a sheet.

## Optional arguments

### `session`

Session ID; optional if pinned or unique.
