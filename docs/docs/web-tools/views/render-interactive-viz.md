---
sidebar_position: 8
---

# Render Interactive Viz

{/* availability */}
<span className="toolAvailability">Available November 2026 and later.</span>
{/* /availability */}

Renders a workbook or view (identified by luid, objectType "workbook" or "view") as a live, interactive Tableau embed the user can explore — filter, drill down, hover, and change selections in place. Use whenever the user wants to see, open, or interact with a view, dashboard, workbook, or viz (e.g. "show me the view", "show me the workbook", "open this dashboard", "let me explore this"). This is the default for any request to display a viz. Returns an interactive embed, NOT a static image — for a fixed image snapshot (screenshot, PNG/PDF, thumbnail) use get-view-image instead.

## APIs called

Talks to Tableau Cloud or Tableau Server.

- Renders a workbook or view (identified by luid, objectType "workbook" or "view") as a live, interactive Tableau embed the user can explore — filter, drill down, hover, and change selections in place.

## Required arguments

### `luid`

The LUID of the workbook or view to render as an interactive embedded viz.

### `objectType`

Whether the luid refers to a "workbook" or a "view".
