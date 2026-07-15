# Chart Best Practices, Common Mistakes & Examples

Implementation reference for chart design decisions in Tableau — covering mark class selection rules, shelf placement, common errors, and worked examples. For chart type selection and shelf configuration by data question, see `chart-selection.md`.

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: create, refine
- In-scope reason: Helps Claude apply chart design best practices and avoid common mistakes when authoring visualizations.
- Out-of-scope risk: none
- Tags: charts, best-practices, mark-class, shelf-placement, examples
- Relevant user prompts/search terms: "which chart type should I use", "bar chart vs line chart", "how to sort a bar chart in Tableau", "dual axis chart example", "why does my chart look wrong", "scatter plot setup", "stacked bar chart configuration", "common chart mistakes", "when to remove gridlines", "mark class selection rules"

## When to Use

Use this guide when:
- **Choosing between two valid chart types** and need a tiebreaker or priority rule
- **Diagnosing a chart that looks wrong** — lines on categorical data, overlapping areas, misleading dual axes
- **Building a specific chart** and need a concrete worked example with shelf placement
- **Coaching a customer** on why their current chart choice is hurting their analysis

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
- **Fix**: Right-click the dimension on the shelf → Sort → Field → descending by the measure.

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
- **Fix**: Never use 3D. Tableau Desktop does not natively support 3D charts, which is by design.

### 8. Area Charts with Multiple Overlapping Series
- **Problem**: Non-stacked area chart with 3+ series.
- **Why it is wrong**: Later series occlude earlier ones. Impossible to read values for hidden series.
- **Fix**: Use Line chart for comparison, or Stacked Area if part-to-whole is the goal.

---

## Implementation

### Shelf placement quick reference

| Shelf | Purpose | Examples |
|---|---|---|
| **Columns** | Horizontal axis | Date for time series; category for vertical bar |
| **Rows** | Vertical axis | Measure for most charts; category for horizontal bar |
| **Color** | Categorical breakdown or sequential measure | Segment, Region, Profit Ratio |
| **Size** | Bubble size, Gantt duration, treemap area | Sales, Duration days |
| **Detail** | Adds granularity without a visual channel | Order ID to disaggregate scatter points |
| **Label/Text** | Displays values on marks | SUM(Sales), % of Total |

### Mark class reference

| Mark Class | Primary Use |
|---|---|
| `Bar` | Comparison, ranking, distribution |
| `Line` | Trends over time |
| `Area` | Volume over time, stacked composition |
| `Circle` | Scatter plots, symbol maps, dot plots |
| `Square` | Heatmaps, treemaps, highlight tables |
| `Text` | Crosstabs, KPI displays |
| `Pie` | Part-to-whole (use sparingly) |
| `GanttBar` | Duration, waterfall charts |
| `Multipolygon` | Filled maps (choropleth) |

---

## Examples

### Example 1: Sales by Category (Horizontal Bar, Sorted)

- **Question**: Which product category has the highest sales?
- **Mark class**: `Bar`
- **Rows**: `[Product Category]` (dimension)
- **Columns**: `SUM([Sales])` (measure)
- **Sort**: Right-click `[Product Category]` → Sort → Field → SUM(Sales), descending
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

---

## Source and Confidence

- Source/evidence type: internal-doc
- Source: imported from prior Tableau authoring knowledge base (mbradbourne)
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-05-22
