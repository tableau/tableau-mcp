# Worksheets: Shelf Configuration & Trellis Charts

Strategy guide for structuring a Tableau worksheet — *how* to lay out rows/columns for the question, when a trellis beats a filtered single view, sort choices, and when to hide a sheet.

Tags: worksheets, shelves, trellis, small-multiples, sorting

**Tactics companion:** `expertise://tableau/tactics/viz/worksheets` — the XML/authoring mechanics (worksheet + window structure, partition-calc XML) for this topic.

## Scope Check


- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: create, refine
- In-scope reason: Helps Claude choose the right rows/columns shelf structure for a user's analytical question, including trellis chart layouts and nested-dimension configurations.
- Out-of-scope risk: none
- Tags: worksheets, shelves, trellis, small-multiples, sorting, rows-columns, hiding-sheets, index-partition
- Relevant user prompts/search terms: "how to configure Rows and Columns shelf", "trellis chart in Tableau", "small multiples layout", "how to sort dimension by measure", "hiding worksheets used in dashboard", "INDEX partition calc for grid", "discrete vs continuous on shelf", "nested dimensions on Rows", "Measure Names and Measure Values", "when to use a trellis vs filter"

## When to Use

Use this guide when:
- **Explaining rows/columns shelf behavior** — discrete vs. continuous fields, multiple fields, nesting
- **Setting up a trellis (small-multiples) chart** using INDEX()-based partition calcs
- **Hiding a worksheet** that is used inside a dashboard but shouldn't appear as a tab
- **Configuring sort options** for dimensions on shelves

---

## Rows and Columns Shelves

The Rows and Columns shelves are the primary way to structure a view in Tableau.

### What fields do on each shelf

| Shelf | Discrete field (blue) | Continuous field (green) |
|---|---|---|
| **Columns** | Creates column headers (category axis) | Creates a horizontal continuous axis |
| **Rows** | Creates row headers (category axis) | Creates a vertical continuous axis |

Placing a dimension on Rows creates one row per member. Placing a measure on Rows creates a continuous vertical axis. Mixing the two (dimension on Rows, measure on Rows) creates a trellis-style layout with separate panes per dimension member.

### Multiple fields on a shelf

Dragging multiple fields onto the same shelf **nests** them:
- Two dimensions on Rows: outer dimension creates major row groups; inner dimension creates sub-rows within each group
- A dimension and a measure on Rows (using `*` to separate them in Tableau's notation): creates a split layout where each dimension member gets its own pane with the measure axis

### Measure Names and Measure Values

Dragging multiple measures onto a shelf automatically invokes Measure Names (a pseudo-dimension) and Measure Values (a pseudo-measure). This creates a multi-measure view where each measure is a row or column.

To control which measures appear: drag Measure Names to the Filters shelf → select which measures to include.

---

## Sorting

### Quick Sort

Click the Sort button on a field pill that's on a shelf to cycle through: original order → sort ascending → sort descending → original order.

### Custom Sort

Right-click a dimension on the Rows or Columns shelf → **Sort** → choose the sort method:
- **Data source order** — original order from the database
- **Alphabetic** — A-Z or Z-A
- **Field** — sort by another field's aggregation (e.g., sort Sub-Category by SUM(Sales) descending)
- **Manual** — drag members into a custom order

Sort by a measure is the most useful for analytical charts — it immediately shows which dimensions rank highest/lowest.

### Computed Sort (Nested)

When multiple dimensions are nested on a shelf, sorting the inner dimension sorts it within each outer dimension group. This is often the desired behavior — top sub-categories per region, not top sub-categories globally.

---

## Hiding Worksheets (Used in Dashboards)

When a worksheet is used inside a dashboard, you may want to hide its tab so users don't navigate to the raw sheet.

**How to hide:** right-click the sheet tab → **Hide Sheet**.

**Conditions for hiding:**
- The sheet must be used in at least one dashboard
- Standalone sheets that aren't on any dashboard cannot be hidden
- Hidden sheets remain fully functional inside dashboards

**To show a hidden sheet again:** on the dashboard, right-click the floating/tiled view that uses that sheet → **Unhide Sheet**, or go to the Sheet menu → Unhide Sheets.

---

## Row Height and Column Width

**Adjust manually:** hover over the row or column header dividers until the resize cursor appears, then drag.

**Set precisely:** right-click a cell → **Row Height** or **Column Width** → enter a pixel value.

Consistent row height is especially important for KPI sparkline tables and Gantt charts, where uniform row sizes create a clean grid.

---

## Trellis / Small-Multiples Chart

A trellis creates a grid of panels — one per combination of dimension members — where each panel shares the same axes. This is useful for comparing patterns across many categories simultaneously.

### How to build a trellis

**Simple trellis (one dimension on Columns, one on Rows):**
1. Place the panel dimension (e.g., Region) on Columns and another dimension on Rows
2. Place the measure on the view — Tableau automatically creates a separate panel per Region
3. Right-click the axis → **Edit Axis** → check **Independent axis ranges for each row or column** if you want each panel to have its own scale (shows patterns within each panel rather than magnitude comparison across panels)

**INDEX()-based trellis (for more control):**
Use when you want an N×M grid with a specific number of columns:

1. Create two calculated fields:
   - `Column Position`: `INT((INDEX() - 1) / [Columns per Row])` — which column (0-based)
   - `Row Position`: `(INDEX() - 1) % [Columns per Row]` — which row within a column

   Where `[Columns per Row]` is a parameter (e.g., 3 for a 3-column grid).

2. Place these as discrete (blue) pills on Rows and Columns respectively
3. Place the dimension to be faceted on Label/Detail
4. Set Compute Using on both INDEX() calcs to the dimension being faceted (right-click → Edit Table Calculation → Specific Dimensions)

**Hiding the partition axis labels:** the row/column position numbers (0, 1, 2…) appear on the axis by default. Format → Field Labels → Rows/Columns → hide them, or format the header to white text.

### When to use a trellis vs. a filtered single view

| Trellis | Single view with filter |
|---|---|
| User needs to compare across all panels simultaneously | User needs to focus on one panel at a time |
| Fewer than ~12 panels (more becomes unreadable) | Any number of members |
| Pattern comparison matters more than individual magnitude | Individual values matter |

---

## Best Practices

- **Keep the worksheet title meaningful.** The default "Sheet 1" title is useless on a dashboard. Either show a descriptive title (Worksheet → Show Title, then double-click to edit) or hide the title and use a Text object on the dashboard instead.
- **Use discrete dimensions on Rows/Columns for categorical structure.** Continuous measures on Rows/Columns create axes — combine them thoughtfully to avoid creating unintended trellis layouts.
- **Sort dimensions by their measure.** A bar chart sorted by SUM(Sales) descending communicates the ranking immediately. Default alphabetical sort forces the reader to search for patterns.
- **For trellis charts, use independent axis ranges only for pattern comparison.** Synchronize axes (the default) when absolute magnitude comparison across panels matters.
- **Hide source sheets on dashboards.** Showing raw data sheets alongside the dashboard breaks the narrative and confuses users about which view to use.

---

## Common Mistakes

1. **A field on the wrong shelf causing an unexpected trellis.** Dragging a measure to Rows when a dimension is already on Rows creates a split trellis layout. If this is accidental, right-click the measure and move it to a different shelf.
2. **Sort reverting after a filter is applied.** If a computed sort (sort by field) references a measure filtered out by a quick filter, the sort may revert to original order. Use a context filter instead, or sort by a different measure.
3. **Trellis panels not showing all dimension members.** If INDEX() is not set to Compute Using the facet dimension, all data collapses into one panel. Right-click each INDEX() calc → Edit Table Calculation → set Specific Dimensions to the facet field.
4. **Hiding a standalone sheet accidentally.** Sheets can only be hidden if they're on a dashboard. If the Hide Sheet option is grayed out, the sheet needs to be added to a dashboard first.
5. **Row heights resetting after sorting.** Custom row heights can reset when the view is sorted differently. Set row height after the final sort is in place.

---

## Implementation

Decide structure before formatting: choose what goes on Rows vs Columns for the question, decide trellis vs filtered single view, set the sort that surfaces the ranking, then hide source sheets that only feed a dashboard. For the worksheet + window XML these decisions produce, see the tactics companion above.

## Source and Confidence

- Source/evidence type: design best-practice
- Source: Best practice for Tableau Rows/Columns shelf structure, trellis layouts, and sorting
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
