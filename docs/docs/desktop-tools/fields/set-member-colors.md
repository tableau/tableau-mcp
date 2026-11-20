---
sidebar_position: 7
---

# Set Member Colors

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Set colors for members of the discrete field on a worksheet's Color.

## APIs called

Talks to the open %product_name% workbook through the External Client API.

- Set colors for members of the discrete field on a worksheet's Color.

## Required arguments

### `worksheetName`

Worksheet name/id.

### `colors`

Members and the color for each: an array of 1 to 100 `{ member, color }` entries. `member` is the member value; true or false for a boolean field. `color` is a hex color, #rrggbb.

## Optional arguments

### `session`

Session ID; optional if pinned or unique.

### `field`

Name or caption of the field on Color; needed only when panes color different fields.

## Notes and caveats

- The color field's datasource must already be in the workbook. If it is not, the tool refuses with `Datasource "name" is not in the workbook`, where `name` is the datasource resolved from the Color encoding.
