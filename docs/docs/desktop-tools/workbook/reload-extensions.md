---
sidebar_position: 22
---

# Reload Extensions

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Reload the extension on a worksheet, or every extension on a dashboard. Storyboards are not supported. Succeeds without reloading anything when the sheet hosts no extension.

## APIs called

Talks to the open %product_name% workbook through the External Client API.

- Reload the extension on a worksheet, or every extension on a dashboard.

## Required arguments

### `sheet`

Worksheet or dashboard name/id whose extensions to reload.

:::note
A storyboard name or id is refused. The tool reports that the name is a storyboard; extensions can only be reloaded on a worksheet or dashboard.
:::

## Optional arguments

### `session`

Session ID; optional if pinned or unique.
