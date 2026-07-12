# Dashboard Layout, Actions & Navigation

Strategy for composing a dashboard — when to use tiled vs floating, how to structure layout containers, which action type fits the interaction, and navigation/control placement decisions.

Tags: dashboards, layout-containers, actions, navigation, parameters

**Tactics companion:** `expertise://tableau/tactics/dashboard/zones` — the zone/action/viewpoint XML mechanics for this topic.

## Scope Check


- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: create, refine, interact
- In-scope reason: This guides Claude when composing dashboards by helping decide between tiled versus floating layouts, which action type fits user interaction needs, and where to place controls.
- Out-of-scope risk: none
- Tags: dashboards, layout-containers, actions, navigation, parameters, tiled-vs-floating, filter-action, highlight-action, go-to-sheet, parameter-action, sidebar, padding, sizing-mode, button
- Relevant user prompts/search terms: "tiled vs floating layout", "filter action not working", "highlight dims everything", "navigation button between dashboards", "parameter action on click", "sidebar filter placement", "dashboard size fixed or automatic", "layout container horizontal vertical", "apply filter to selected sheets", "go to sheet action setup"

## When to Use

Use this guide when:
- **A customer is building a dashboard** and needs layout, sizing, or action configuration help
- **Setting up filter actions or highlight actions** between worksheets
- **Adding navigation buttons** to move between dashboards
- **Configuring parameter actions** that respond to user clicks
- **Explaining the difference between tiled and floating layouts**

For the design strategy behind layout choices (Z-pattern, BAN rows, sidebar filters), see `data/knowledge/strategy/dashboard-design/dashboard-layout-patterns.md`.

---

## Dashboard Layout Modes

Tableau dashboards support two layout modes:

| Mode | Behavior | When to use |
|---|---|---|
| **Tiled** | Objects snap to a grid; containers enforce alignment automatically | Default; recommended for most dashboards |
| **Floating** | Objects placed at arbitrary x/y positions; can overlap | Annotations, logos, show/hide panels that overlay content |

**Use Tiled for all structural layout.** Floating elements are fragile — they don't reflow when the dashboard resizes and can overlap tiled content unexpectedly. Only float objects that intentionally overlay (like a tooltip panel or a decorative logo).

To switch an object from tiled to floating: hold Shift while dragging it, or use the dropdown menu on the object.

---

## Layout Containers

Layout containers control how child objects are arranged:

| Container | Behavior |
|---|---|
| **Horizontal** | Arranges children side-by-side |
| **Vertical** | Stacks children top to bottom |
| **Tiled (auto)** | Tableau creates containers automatically based on where you drop objects |

**Distribute evenly:** right-click a layout container → **Distribute Contents Evenly** — makes all children equal width (horizontal) or equal height (vertical). Useful for BAN rows.

**Fixed vs. flexible size:** select a container or object → Layout pane (left sidebar) → set a fixed width or height, or leave it flexible. Sidebar filter containers should typically have a fixed width (~250px) to hold their size as the dashboard resizes.

---

## Padding and Spacing

Dashboard padding is set via the Layout pane when an object or container is selected:

| Setting | Meaning |
|---|---|
| **Inner padding** | Space inside the container, between the container border and its contents |
| **Outer padding** | Space between this container and its siblings |

Recommended values: inner 8px for content containers, outer 0px (let the parent handle spacing).

**Using blank objects as spacers:** drag a Blank object from the Objects panel onto the dashboard to create fixed-size gaps between content. Useful for precise pixel-level control that padding alone can't achieve.

---

## Dashboard Size

Set via **Dashboard menu → Dashboard Size**.

| Mode | Description | Use case |
|---|---|---|
| **Fixed** | Exact width and height | Presentations, kiosks, PDF export |
| **Automatic** | Resizes to fill the container | Embedded in web apps |
| **Range** | Min/max width and height bounds | Responsive layouts |
| **Vertical Scroll** | Fixed width, scroll vertically | Multi-chart dashboards with more content than viewport |

For multi-chart dashboards with 4+ views, use **Vertical Scroll** to prevent charts from being squished. Reserve Fixed for simple 1-3 chart dashboards where all content fits in the viewport.

---

## Dashboard Actions

Actions let users interact with the dashboard — selecting a mark in one view can filter, highlight, or update other views.

### Filter Action

Filters target worksheets based on a mark selection.

**Create:** Dashboard menu → Actions → Add Action → Filter

Key settings:
- **Source sheets:** which sheets trigger the action (on hover or on select)
- **Target sheets:** which sheets get filtered
- **Fields to filter:** All Fields (recommended for simplicity) or specific fields
- **Clearing the selection:** Show all values, Exclude all values, or Leave the filter

**"All Fields" approach:** Tableau automatically matches fields with the same name between the source and target. This is the simplest setup and handles most cases.

### Highlight Action

Dims all marks except those matching the selection in the source sheet.

**Create:** Dashboard menu → Actions → Add Action → Highlight

Highlight actions work best when all views share the same datasource and have a common dimension. They are non-destructive — they don't remove data from any view, just dim non-matching marks.

### Go To Sheet / URL Action

Navigates to another dashboard or worksheet, or opens an external URL.

**Create:** Dashboard menu → Actions → Add Action → Go to Sheet (or URL)

Used to build multi-dashboard navigation flows — clicking a row in a summary dashboard navigates to a detail dashboard.

### Parameter Action

Updates a parameter's value based on a user's selection.

**Create:** Dashboard menu → Actions → Add Action → Change Parameter

Key settings:
- **Source field:** the field on the source sheet whose value sets the parameter
- **Target parameter:** which parameter to update
- **Aggregation:** usually Attribute (the single value from the selected mark)

Parameter actions are useful for dynamic control — clicking a category updates a parameter that changes what is shown in another view.

---

## Navigation Buttons

Navigation buttons link dashboards together for multi-page experiences.

**Add a navigation button:**
1. On the dashboard, drag a **Button** object from the Objects panel onto the canvas
2. In the Edit Button dialog: set Navigate to a Sheet → select the target dashboard
3. Style: choose Image or Text button, set the caption

**Button best practices:**
- Place all navigation buttons consistently — typically at the top or top-right of the dashboard
- Use the same button style (same font, same background color) across all dashboards for a consistent navigation bar feel
- The currently-active dashboard's button should look different (use a bold/highlighted state) — configure via Edit Button → Style

---

## Filter and Parameter Controls on Dashboards

### Filter Controls

Drag a worksheet's filter from the Filters shelf onto the dashboard, or:
- Click the dropdown arrow on a sheet in the dashboard → Filters → select the filter field
- The control appears as a widget on the dashboard

Configure the control type (single select, multi-select, dropdown, slider) by right-clicking the control → Customize.

Set which worksheets the filter applies to: click the dropdown on the control → Apply to Worksheets → Selected Worksheets / All Using This Data Source.

### Parameter Controls

Right-click a parameter in the Data pane → Show Parameter Control. The control appears on the right side of the sheet — drag it onto the dashboard layout.

Parameter controls are global — they affect all sheets that reference the parameter, regardless of Apply to Worksheets settings.

---

## Dashboard Axis Cleanup

A common polishing step is removing or renaming axis titles on dashboard sheets:

**Remove an axis title:** double-click the axis → Edit Axis → uncheck Show axis title.

**Rename an axis title:** double-click the axis → Edit Axis → type the new title in the Title field. Renaming "SUM(Sales)" to "Revenue" is the most common case.

**Hide field labels:** Format → Field Labels → Rows/Columns → Hide. Removes the "Sub-Category" header row above charts, which is redundant when the axis tick labels already convey the information.

---

## Hiding Worksheets in Dashboards

Sheets used in a dashboard can be hidden from the tab bar so users don't navigate to them directly.

**Hide:** right-click the sheet tab → Hide Sheet. The sheet remains functional inside the dashboard.

**Requirements:** the sheet must be placed on at least one dashboard before it can be hidden.

**Unhide:** Dashboard menu → Unhide Sheets, or right-click the view on the dashboard → Unhide Sheet.

---

## Saving Workbooks

**Save:** Ctrl+S (Windows) / Cmd+S (Mac). If the workbook has never been saved, this opens a Save As dialog.

**Save As:** File → Save As. Use to save to a different location or file name.

**Save to Tableau Server/Cloud:** File → Save to Tableau Server / Save to Tableau Cloud. Prompts for server address and credentials if not already connected.

**Revert to Saved:** File → Revert to Saved. Discards all changes since the last save. Use to recover from a bad editing session.

---

## Best Practices

- **Always test filter and highlight actions after setup.** Click marks in the source sheet and verify the expected sheets respond. Filter actions with no matching fields silently do nothing.
- **Use "All Fields" for filter actions unless you need specificity.** Specific-field filter actions require exact field name matches between source and target — easy to break when fields are renamed.
- **Set a clear selection behavior.** Decide whether clearing a selection shows all data or excludes all data, and be consistent across all filter actions on the dashboard.
- **Avoid more than 2-3 navigation buttons per dashboard.** Too many navigation options confuse users. Use a simple linear flow (Summary → Detail) or a top-level navigation bar with no more than 5 destinations.
- **Parameter controls are always global.** If a parameter is shown on multiple dashboards, updating it on one affects all of them — this is usually the desired behavior, but make sure customers understand it.

---

## Common Mistakes

1. **Filter action not affecting a target sheet.** Check that the target sheet has a field matching the source field (same name, same datasource). Cross-datasource filter actions only work for fields with matching names and the same underlying data.
2. **Highlight action dimming everything.** If the highlighted field doesn't exist in the target sheet, Tableau dims all marks. Add the highlight field to the target sheet's Detail shelf.
3. **Parameter action not updating.** Check that the source field's aggregation is set to Attribute (not Sum/Count) — parameter actions need a single value, not an aggregate.
4. **Navigation button linking to the wrong dashboard.** Verify the button's sheet reference in Edit Button → Navigate to Sheet after renaming any dashboards.
5. **Filter control applying to unintended sheets.** Check the Apply to Worksheets setting — "All Using This Data Source" applies the filter to every sheet using that datasource, including sheets the designer didn't intend.

---

## Implementation

Decide layout and interaction before building: pick the size mode, structure containers for the reading order, choose action types (filter/highlight/navigate) for the intended flow, and place controls where users expect them. For the zone/action XML these decisions produce, see the tactics companion above.

## Source and Confidence

- Source/evidence type: SME-authored reference
- Source: Tableau dashboard authoring best practice — layout containers, actions, navigation — from product docs and SE field practice
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
