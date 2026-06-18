# Visualization: Chart Type Selection

## When to Use This Module

Use this guide when deciding which chart type to build for a given analytical question. This module maps data questions to Tableau mark classes and shelf configurations so an AI agent can programmatically author the correct visualization without trial and error.

---

## Decision Framework: Data Question → Chart Type

### Step 1: Classify the Data Question

Every visualization answers one of these question types:

| Question Category | Core Question | Primary Mark Classes |
|---|---|---|
| **Comparison** | How do values differ across categories? | Bar |
| **Change over Time** | How does a measure evolve over time? | Line, Area |
| **Part-to-Whole** | What share does each part contribute? | Bar (stacked), Pie, Area (stacked) |
| **Distribution** | How are values spread? | Circle, Bar (histogram), Bar (box plot) |
| **Relationship** | How do two measures correlate? | Circle (scatter) |
| **Ranking** | What is the order from best to worst? | Bar (sorted) |
| **Geographic** | Where do values concentrate spatially? | Multipolygon, Circle (on map) |
| **Composition** | What are the components at a point in time? | Bar (stacked), Area (stacked) |

### Step 2: Match to Chart Type and Configuration

Use the detailed entries below. Each entry specifies the Tableau mark class, shelf layout, and decision criteria.

---

## Chart Types Reference

### 1. Bar Chart (Vertical)

- **Mark class**: `Bar`
- **Shelf config**: Dimension on Columns, Measure on Rows
- **Data question**: Comparison across categories (fewer than ~20 categories)
- **When to use**: Comparing discrete categories where label length is short. Default choice for categorical comparison.
- **When NOT to use**: More than 20 categories (switch to horizontal bar). Continuous time axis (use Line). Showing trends (use Line).
- **Encoding notes**: Color on a second dimension for grouped/stacked bars. Use `SortOrder: "Descending"` on the dimension to create a ranked bar chart.

### 2. Bar Chart (Horizontal)

- **Mark class**: `Bar`
- **Shelf config**: Measure on Columns, Dimension on Rows
- **Data question**: Comparison or ranking across categories, especially with long labels
- **When to use**: Category labels are long strings (product names, region descriptions). Ranking questions (sort descending). More than 10 categories.
- **When NOT to use**: Time-based axis (time should always be horizontal). Fewer than 4 very short labels (vertical bar is fine).
- **Opinionated guidance**: Horizontal bars are almost always better than vertical for ranking. Always sort by the measure — unsorted bars are nearly useless for comparison. This is the single most versatile chart type.

### 3. Stacked Bar Chart

- **Mark class**: `Bar`
- **Shelf config**: Dimension on Columns, Measure on Rows, second Dimension on Color
- **Data question**: Part-to-whole composition across categories
- **When to use**: Showing how a total breaks down into 2-4 sub-categories. Comparing totals AND composition simultaneously.
- **When NOT to use**: More than 5 color segments — becomes unreadable. When the audience needs to compare individual segments precisely (use grouped bars instead). When segments have no meaningful total.
- **Opinionated guidance**: Limit to 4-5 color segments maximum. Consider 100% stacked bars if only the proportions matter, not the absolute values.

### 4. Line Chart

- **Mark class**: `Line`
- **Shelf config**: Date/time dimension on Columns, Measure on Rows
- **Data question**: Change over time, trend identification
- **When to use**: Continuous time axis. Showing trends, patterns, seasonality. Comparing trends across 2-5 series.
- **When NOT to use**: Categorical (non-ordered) X axis — lines imply continuity between points. More than 7 series (becomes spaghetti). Sparse data with large gaps (use Bar or Circle).
- **Opinionated guidance**: Never use lines for categorical data — this is the single most common chart crime. Lines imply interpolation between points. Limit to 5-6 series; beyond that, use small multiples or highlight one series. Always include zero baseline for rate/amount data unless the variation is the point.
- **Encoding notes**: Place the date field with continuous aggregation (YEAR, MONTH, etc.) on Columns. Multiple measures: use Measure Names on Color, Measure Values on Rows.

### 5. Area Chart

- **Mark class**: `Area`
- **Shelf config**: Date/time dimension on Columns, Measure on Rows
- **Data question**: Change over time with emphasis on volume/magnitude
- **When to use**: Single series where you want to emphasize cumulative magnitude. Stacked area for showing composition changes over time.
- **When NOT to use**: Multiple overlapping (non-stacked) series — areas occlude each other. When precise value reading matters (Line is better). Negative values.
- **Opinionated guidance**: Stacked area is excellent for 2-4 series showing part-to-whole over time. Never use overlapping (non-stacked) area charts — they hide data. For a single series, area adds visual weight that can emphasize volume effectively.

### 6. Scatter Plot

- **Mark class**: `Circle`
- **Shelf config**: Measure on Columns, Measure on Rows
- **Data question**: Relationship/correlation between two measures
- **When to use**: Exploring correlation between two continuous variables. Identifying outliers. Cluster analysis.
- **When NOT to use**: One axis is categorical (use Bar). Fewer than ~15 data points (use a table). Audience unfamiliar with scatter interpretation.
- **Encoding notes**: Size on a third measure for bubble chart. Color on a dimension for group identification. Detail on a dimension to disaggregate points. Add a trend line via analytics pane for correlation emphasis.
- **Opinionated guidance**: Always put the independent/explanatory variable on Columns (X). Add a dimension to Detail to control granularity — without it, you get one aggregated dot. Size encoding (bubble chart) works for a third measure but keep the size range moderate.

### 7. Histogram

- **Mark class**: `Bar`
- **Shelf config**: Binned measure on Columns, CNT or CNTD on Rows
- **Data question**: Distribution of a single measure
- **When to use**: Understanding how values are distributed (normal, skewed, bimodal). Identifying outliers and concentration.
- **When NOT to use**: Categorical data (use a standard bar chart). When exact values matter more than distribution shape.
- **Implementation note**: Create a bin calculation on the measure first (right-click field → Create Bins). Place the bin on Columns, COUNT on Rows. Set mark class to Bar.

### 8. Text Table / Crosstab

- **Mark class**: `Text`
- **Shelf config**: Dimensions on Rows and Columns, Measure on Text
- **Data question**: Exact value lookup across two dimensions
- **When to use**: Audience needs precise numbers. Dashboard KPI displays. Small number of cells (under 50).
- **When NOT to use**: More than ~50 cells (use a heatmap or chart instead). When patterns/trends are more important than exact values.
- **Encoding notes**: Use Color on the measure to add a heatmap effect to the text table, making patterns visible while retaining exact values.

### 9. Heatmap

- **Mark class**: `Square` or `Heatmap`
- **Shelf config**: Dimension on Columns, Dimension on Rows, Measure on Color
- **Data question**: Pattern identification across two categorical dimensions
- **When to use**: Large matrix of values where color patterns reveal insights. Time-of-day / day-of-week analysis. Correlation matrices.
- **When NOT to use**: Fewer than 3 categories on each axis (use a bar chart). When exact values are critical (add Text label or use crosstab).
- **Opinionated guidance**: Use a sequential color palette (light-to-dark) for a single measure. Use diverging palette (red-white-blue) when there is a meaningful midpoint. The `Square` mark class is preferred over `Heatmap` for most use cases as it gives cleaner cell boundaries.

### 10. Pie Chart

- **Mark class**: `Pie`
- **Shelf config**: Dimension on Color, Measure on Angle (Size)
- **Data question**: Part-to-whole for a small number of categories
- **When to use**: 2-3 categories where the audience expects a pie (e.g., market share). When the primary insight is "one segment dominates."
- **When NOT to use**: More than 5 categories — switch to a horizontal bar sorted by value. When comparing slice sizes that are close in value (humans are bad at comparing angles). When showing change over time.
- **Opinionated guidance**: Avoid pie charts in almost all analytical contexts. A sorted horizontal bar chart communicates the same information more precisely and scales to any number of categories. If you must use a pie, limit to 5 slices and include value labels. Never use 3D pie charts — they distort proportions.

### 11. Treemap

- **Mark class**: `Square`
- **Shelf config**: Dimension on Detail, Measure on Size, optionally Dimension on Color
- **Data question**: Hierarchical part-to-whole with many categories
- **When to use**: Showing relative sizes across many categories (20+). Hierarchical data with multiple levels.
- **When NOT to use**: Fewer than 5 categories (use bar chart). When precise comparison matters (rectangles are hard to compare). When there is no meaningful size measure.
- **Encoding notes**: No row/column placement. The dimension goes on Detail (or Label), the measure on Size. A second dimension on Color can show a categorical grouping.

### 12. Packed Bubble Chart

- **Mark class**: `Circle`
- **Shelf config**: Dimension on Detail, Measure on Size
- **Data question**: Relative magnitude comparison with visual appeal
- **When to use**: High-level overview of relative sizes. Engagement-oriented dashboards.
- **When NOT to use**: When precise comparison is needed (bubbles are hard to compare accurately). Analytical dashboards where accuracy matters. Any situation where a bar chart would work.
- **Opinionated guidance**: Packed bubbles are visually appealing but analytically weak. Use them sparingly and only for general impressions of magnitude, never for precise analysis.

### 13. Gantt Bar

- **Mark class**: `GanttBar`
- **Shelf config**: Dimension on Rows, Date on Columns, Duration measure on Size
- **Data question**: Duration, scheduling, spans across time
- **When to use**: Project timelines. Event durations. Waterfall charts (via table calculations).
- **When NOT to use**: When you only have a single point in time (use Circle or Bar). When there is no duration component.
- **Implementation note**: Place the start date on Columns (continuous), a duration measure on Size. Each bar starts at the date value and extends by the Size value.

### 14. Map (Filled / Symbol)

- **Mark class**: `Multipolygon` (filled map) or `Circle` (symbol map)
- **Shelf config**: Geographic dimension on Detail, Latitude on Rows, Longitude on Columns
- **Data question**: Geographic distribution of values
- **When to use**: Data has a geographic component (country, state, zip, lat/lon). Spatial patterns are the primary insight.
- **When NOT to use**: Geography is incidental — a bar chart sorted by value is more precise. Only a few geographic regions (use a bar chart). The map would be mostly empty.
- **Opinionated guidance**: Filled maps (choropleth) distort perception because large regions dominate visually regardless of data value. Symbol maps with sized circles are often more honest. Always consider whether a sorted bar chart would answer the question better — maps are overused.
- **Encoding notes**: For filled maps, use `Multipolygon` mark with geographic role assigned to the dimension. For symbol maps, use `Circle` mark with Measure on Size and/or Color. Tableau auto-generates Latitude/Longitude when it recognizes geographic fields.

### 15. Highlight Table

- **Mark class**: `Square`
- **Shelf config**: Dimension on Rows, Dimension on Columns, Measure on Color, Measure on Label
- **Data question**: Pattern identification with exact values visible
- **When to use**: Matrix view where both the pattern and exact values matter. KPI dashboards with color-coded status.
- **When NOT to use**: Too many cells (>100) — becomes overwhelming. When the pattern alone is sufficient (use heatmap without labels).

### 16. Dual-Axis Chart

- **Mark class**: Varies (commonly `Bar` + `Line`)
- **Shelf config**: Shared dimension on Columns, Measure 1 on Rows (left axis), Measure 2 on Rows (right axis, dual axis)
- **Data question**: Comparing two measures with different scales on the same view
- **When to use**: Volume vs. rate (e.g., sales amount + margin %). Two measures that share a dimension but have very different scales.
- **When NOT to use**: When measures share the same scale (use a single axis). More than 2 measures (use separate charts). When the dual axes could mislead (different zero points, manipulated ranges).
- **Opinionated guidance**: Dual axes are frequently misused. They can suggest false correlations. Always synchronize axes when possible. If the scales are wildly different, consider separate charts stacked vertically instead. Never use dual axis to overlay unrelated measures.
- **Implementation note**: In workbook JSON, create two measure columns on Rows, then set the second axis as dual via the axis configuration.

---

## Best Practices

### General Rules

1. **Start with bars**: When uncertain, a sorted horizontal bar chart is the safest default. It works for comparison, ranking, composition, and distribution.
2. **One chart, one message**: Each visualization should answer one clear question. If you need to show multiple things, use multiple charts.
3. **Sort deliberately**: Always sort categorical axes by the measure of interest, not alphabetically, unless alphabetical order is the point (e.g., a lookup table).
4. **Limit color categories to 5-7**: Beyond this, colors become indistinguishable. Use "Other" grouping or highlight a subset.
5. **Include zero baseline for bar charts**: Truncated bar chart axes distort magnitude comparisons. Lines are more flexible — zero baseline is not always required.
6. **Prefer small multiples over spaghetti**: Instead of 10 lines on one chart, use a grid of individual charts (one per category).
7. **Label directly**: Place labels on or near marks instead of relying solely on legends, especially for 2-3 series.

### Mark Class Selection Priority

When the question could be answered by multiple chart types, prefer in this order:

1. **Bar** — highest precision for categorical comparison
2. **Line** — best for temporal trends
3. **Circle** (scatter) — best for bivariate relationships
4. **Text** — best for exact value lookup (small data)
5. **Square** (heatmap) — best for dense matrix patterns
6. **Area** — use only when volume emphasis adds meaning
7. **Pie** — rarely the best choice; use Bar instead

---

## Common Mistakes

### 1. Lines for Categorical Data
- **Problem**: Using Line mark for a categorical (unordered) dimension on the X axis.
- **Why it is wrong**: Lines imply continuity and order. Connecting "Furniture" to "Technology" with a line suggests interpolation that does not exist.
- **Fix**: Use Bar mark for categorical comparisons.

### 2. Too Many Pie Slices
- **Problem**: Pie chart with 8+ categories, many of similar size.
- **Why it is wrong**: Humans cannot accurately compare angles, especially when slices are similar. Small slices become invisible.
- **Fix**: Replace with horizontal bar chart sorted by value.

### 3. Unsorted Bar Charts
- **Problem**: Bar chart with categories in alphabetical or arbitrary order.
- **Why it is wrong**: The audience must visually scan all bars to find the largest/smallest. Sorting does this work for them.
- **Fix**: Apply a computed sort on the dimension by the measure, descending.

### 4. Dual-Axis Scale Manipulation
- **Problem**: Two axes with different ranges that visually align unrelated patterns.
- **Why it is wrong**: Creates false visual correlation. A line crossing a bar at a certain point is meaningless if the scales differ.
- **Fix**: Synchronize axes when units are compatible. Use separate stacked charts when they are not.

### 5. Overloaded Single Chart
- **Problem**: One chart with 10+ series, 3 encodings, dual axes, and reference lines.
- **Why it is wrong**: Cognitive overload — the audience cannot extract any single insight.
- **Fix**: Split into multiple focused charts. Use a dashboard layout.

### 6. Filled Maps for Non-Geographic Insights
- **Problem**: Using a filled map when a bar chart would answer the question more precisely.
- **Why it is wrong**: Geographic area dominates visual perception. Alaska looks 100x more important than Connecticut regardless of data values.
- **Fix**: Use a sorted bar chart. Reserve maps for when spatial pattern is the actual insight.

### 7. 3D Charts
- **Problem**: Any 3D visualization (3D bars, 3D pie, etc.).
- **Why it is wrong**: Perspective distortion makes accurate comparison impossible. Front elements occlude back elements.
- **Fix**: Never use 3D. Tableau Desktop does not natively support 3D, which is a feature, not a limitation.

### 8. Area Charts with Multiple Overlapping Series
- **Problem**: Non-stacked area chart with 3+ series.
- **Why it is wrong**: Later series occlude earlier ones. Impossible to read values for hidden series.
- **Fix**: Use Line chart for comparison, or Stacked Area if part-to-whole is the goal.

---

## Implementation in Tableau Desktop

### Mark Class Reference (Workbook JSON)

The `mark` node's `class` attribute controls chart type. Valid values:

| Mark Class | JSON Value | Primary Use |
|---|---|---|
| Automatic | `Automatic` | Let Tableau decide (avoid for programmatic authoring) |
| Bar | `Bar` | Comparison, ranking, distribution |
| Line | `Line` | Trends over time |
| Area | `Area` | Volume over time, stacked composition |
| Circle | `Circle` | Scatter plots, symbol maps, dot plots |
| Square | `Square` | Heatmaps, treemaps, highlight tables |
| Text | `Text` | Crosstabs, KPI displays |
| Pie | `Pie` | Part-to-whole (use sparingly) |
| Shape | `Shape` | Custom shape marks |
| Gantt Bar | `GanttBar` | Duration, waterfall charts |
| Polygon | `Polygon` | Custom geographic shapes |
| Heatmap | `Heatmap` | Density heatmaps |
| Multipolygon | `Multipolygon` | Filled maps (choropleth) |

### Shelf Configuration in Workbook JSON

Shelves are encoded as `column` and `row` entries in the worksheet's `datasource-dependencies` and `rows`/`cols` elements:

- **Columns shelf**: Controls the horizontal axis. Place date fields here for time series. Place categories here for vertical bar charts.
- **Rows shelf**: Controls the vertical axis. Place measures here for most charts. Place categories here for horizontal bar charts.
- **Color**: Encoded in `pane > encodings > color`. Used for categorical breakdown or sequential measure encoding.
- **Size**: Encoded in `pane > encodings > size`. Used for bubble charts, Gantt bar duration, treemap area.
- **Detail**: Encoded in `pane > encodings > lod > column-instance`. Adds granularity without a visual encoding.
- **Label/Text**: Encoded in `pane > encodings > text`. Displays values on marks.

### Programmatic Authoring Guidelines

1. **Always set mark class explicitly**: Never use `Automatic`. Specify the exact mark class to ensure deterministic output.
2. **Match shelf placement to chart type**: The same data on different shelves produces different charts. A dimension on Rows + measure on Columns = horizontal bar. Swap them = vertical bar.
3. **Sort via view-level sort node**: Do not rely on CDP sort commands. Use a `sort` node with `class="computed"`, `direction="DESC"`, and `using="[Datasource].[Measure]"` for reliable sorted bar charts.
4. **Color encoding goes in pane**: Place color configuration in `pane > encodings > color`, not inside the mark node. This is a common gotcha — mark-level color encoding gets stripped by `loadMetadataFromXml`.
5. **Table calculations in ds-deps**: Table calc configuration belongs in `column-instance` children within `datasource-dependencies`, with `:2` suffix on the name and `ordering-type="Field"`.

---

## Examples

### Example 1: Sales by Category (Horizontal Bar, Sorted)

- **Question**: Which product category has the highest sales?
- **Mark class**: `Bar`
- **Rows**: `[Product Category]` (dimension)
- **Columns**: `SUM([Sales])` (measure)
- **Sort**: Computed, descending by `SUM([Sales])`
- **Why this works**: Horizontal bars accommodate category labels, sorting makes ranking instant.

### Example 2: Monthly Revenue Trend (Line)

- **Question**: How has revenue changed over the past 12 months?
- **Mark class**: `Line`
- **Columns**: `MONTH([Order Date])` (continuous)
- **Rows**: `SUM([Revenue])`
- **Why this works**: Continuous time on X, line implies trend and continuity.

### Example 3: Profit vs. Sales (Scatter)

- **Question**: Is there a relationship between sales volume and profit?
- **Mark class**: `Circle`
- **Columns**: `SUM([Sales])`
- **Rows**: `SUM([Profit])`
- **Detail**: `[Product Name]` (to disaggregate)
- **Color**: `[Category]` (to group)
- **Why this works**: Two continuous measures, one on each axis. Detail provides granularity.

### Example 4: Market Share by Region (Stacked Bar)

- **Question**: What share of total sales does each region contribute, by year?
- **Mark class**: `Bar`
- **Columns**: `YEAR([Order Date])`
- **Rows**: `SUM([Sales])`
- **Color**: `[Region]`
- **Why this works**: Stacked bars show both the total (bar height) and composition (color segments).

### Example 5: Sales Density by State (Filled Map)

- **Question**: Where are sales concentrated geographically?
- **Mark class**: `Multipolygon`
- **Detail**: `[State]` (geographic role: State/Province)
- **Color**: `SUM([Sales])` (sequential palette)
- **Why this works**: Geographic pattern is the primary insight. Filled regions show concentration at a glance.

### Example 6: Day-of-Week / Hour Heatmap

- **Question**: When are orders most frequent?
- **Mark class**: `Square`
- **Columns**: `HOUR([Order DateTime])`
- **Rows**: `WEEKDAY([Order DateTime])`
- **Color**: `CNT([Orders])`
- **Why this works**: Two temporal dimensions form a grid. Color intensity reveals peak periods instantly.

### Example 7: Revenue and Margin % Over Time (Dual Axis)

- **Question**: How do revenue and margin % trend together?
- **Mark class**: `Bar` (revenue, left axis) + `Line` (margin %, right axis)
- **Columns**: `MONTH([Date])` (continuous)
- **Rows**: `SUM([Revenue])` (left), `AVG([Margin %])` (right, dual axis)
- **Why this works**: Revenue (volume) and margin (rate) have different scales. Dual axis is justified because both share the time dimension and the relationship is meaningful. Bar vs. line differentiation prevents visual confusion.
