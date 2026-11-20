---
sidebar_position: 16
---

# Undo or Redo

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Undo reverses the most recent change to the open workbook (Edit > Undo). Redo reapplies the change most recently undone (Edit > Redo).

## APIs called

This tool asks the running %product_name% instance, through the local **%product_name% %ecapi_name%**, to undo or redo the open workbook. There are no OAuth scopes.

## Required arguments

### `action`

`undo` reverses the most recent change. `redo` reapplies the change most recently undone.

#### Example

`"undo"`

## Optional arguments

### `session`

Session ID. Optional when a session is pinned or only one %product_name% instance is connected.

#### Example

`"12345"`

## Notes and caveats

- Undo changes the open workbook. It is not a read, and repeating it walks further back through the undo stack.
- %product_name% owns the undo history. The tool does not inspect it, and the result does not say which change was undone or redone.
- Moving to another sheet is itself a change, so an undo immediately after a navigation can reverse that navigation.
- When %product_name% accepts the request before it has settled, the result says the undo or redo was requested and is still being applied.
