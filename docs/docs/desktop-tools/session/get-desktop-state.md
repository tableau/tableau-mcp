---
sidebar_position: 4
---

# Get %product_name% State

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Report whether %product_name% is idle or blocked, the strongest observed blocking cause, all active native activities, UI snapshot completeness, and visible modal or progress window content. When a modal needs action, obtain fresh exact identity and actions from get-active-dialogs before considering invoke-dialog-action.

## APIs called

Talks to the running %product_name% instance through the External Client API.

- Report whether %product_name% is idle or blocked, the strongest observed blocking cause, all active native activities, UI snapshot completeness, and visible modal or progress window content.

## Optional arguments

### `session`

Session ID; optional if pinned or unique.
