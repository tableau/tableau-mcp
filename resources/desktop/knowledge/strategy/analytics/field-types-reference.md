# Tableau Field & Mark Type Reference

Quick-reference tables for Tableau field roles, data types, mark types, and filter classes. Use when authoring calculated fields, explaining field behavior, or troubleshooting display issues.

Tags: field-roles, data-types, mark-types, filter-classes, reference

**Tactics companion:** `expertise://tableau/tactics/tree/enums` — the XML/authoring mechanics for this topic.

## Scope Check


- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: troubleshoot, format
- In-scope reason: This quick reference helps Claude explain field behavior when a user's field displays incorrectly or filters behave unexpectedly, essential for troubleshooting authoring issues.
- Out-of-scope risk: none
- Tags: field-roles, data-types, mark-types, filter-classes, reference, dimension, measure, discrete, continuous, datatype, string, integer, real, boolean, date, datetime, automatic-mark, bar, line, area, circle, text, gantt, polygon
- Relevant user prompts/search terms: "dimension vs measure difference", "discrete vs continuous field", "why is my pill blue not green", "change field to continuous", "what mark type for scatter plot", "categorical filter dropdown", "date filter relative last N days", "automatic mark type not working", "field role behavior", "convert field to dimension"

## When to Use

Use this guide when:
- **A customer asks why a field behaves differently than expected** — check role, type, and datatype
- **Choosing a mark type** for a chart type discussion
- **Explaining the difference between dimensions and measures**, or discrete vs. continuous
- **Troubleshooting filter dialog options** that differ from what a customer expects

---

## Field Roles

| Role | Behavior | Default pill color |
|---|---|---|
| **Dimension** | Slice and group data; categorical | Blue |
| **Measure** | Aggregate values; numeric | Green |

A field's role determines the default aggregation behavior and which shelf options are available. Right-click any field in the Data pane → Change to Dimension / Change to Measure to override.

---

## Field Types (Discrete vs Continuous)

| Type | Behavior | Pill color |
|---|---|---|
| **Discrete** (nominal / ordinal) | Creates headers; values listed | Blue |
| **Continuous** (quantitative) | Creates axes; values on a scale | Green |

The type is independent of the role — you can have a discrete measure (e.g., RANK() on Rows as a discrete blue pill) or a continuous dimension (e.g., a date on Columns as a continuous green axis).

Right-click a pill on a shelf → **Convert to Discrete** or **Convert to Continuous**.

---

## Data Types

| Datatype | What it holds | Examples |
|---|---|---|
| `string` | Text | "West", "Customer A" |
| `integer` | Whole numbers | 42, 1000 |
| `real` | Decimal numbers | 3.14, 1234.56 |
| `boolean` | True/False | Is Profitable: True |
| `date` | Date only | 2024-01-15 |
| `datetime` | Date + time | 2024-01-15 09:30:00 |

Tableau infers the data type from the source. You can change it in the Data pane: right-click the field → **Change Data Type**.

---

## Mark Types

| Mark type | Typical chart |
|---|---|
| **Automatic** | Tableau chooses based on what's on the shelves |
| **Bar** | Categorical comparisons |
| **Line** | Trends over time |
| **Area** | Stacked/filled time series |
| **Circle** | Scatter plots, dot plots |
| **Square** | Filled square marks |
| **Shape** | Shape-encoded categories |
| **Text** | Text tables, BAN numbers |
| **Pie** | Part-to-whole (use sparingly) |
| **Gantt Bar** | Timeline / project charts |
| **Polygon** | Custom polygon outlines |

Change the mark type from the dropdown at the top of the marks card.

**When Automatic works well:** Tableau's Automatic selection is correct for most standard charts — Bar when comparing categories, Line when dates are on Columns, Circle for scatter. Override it manually when you need a specific type that Automatic wouldn't choose (e.g., forcing Line when Tableau auto-selects Bar for discrete dates, or using Gantt Bar for timeline work).

---

## Filter Classes

| Filter class | When it appears |
|---|---|
| **Categorical** | Dimension filter — check boxes or dropdown to include/exclude members |
| **Quantitative (range)** | Measure filter or continuous date filter — min/max slider |
| **Relative date** | Date dimension filter — "last N days/weeks/months" |
| **Top N** | Dimension filter → Top tab — limit to top/bottom N by a measure |

The filter class determines the dialog presented when you drag a field to the Filters shelf. Dates offer a special dialog with multiple filter types to choose from.

---

## Dashboard Zone Types

| Zone type | What it is |
|---|---|
| **Visual** | A worksheet (sheet view) |
| **Text** | A static text object |
| **Image** | A static image/logo |
| **Filter** | A filter control |
| **Parameter control** | A parameter control widget |
| **Blank** | Empty spacer zone |
| **Web page** | Embedded URL content |
| **Layout container** | Horizontal or vertical grouping container |

In Tableau Desktop's dashboard canvas, these correspond to the object types in the Objects panel at the bottom of the dashboard layout panel.

---

## Best Practices

- Use the guidance above as the starting point for Tableau dashboard and visualization authoring decisions.
- Validate the recommendation against the specific workbook, data, and customer goal before applying it.
- Prefer supported Tableau authoring patterns over one-off workarounds.

## Common Mistakes

- Treating this guidance as generic SE enablement rather than Tableau authoring guidance.
- Applying the pattern without checking whether it fits the dashboard, visualization, or workbook context.
- Skipping validation in Tableau after making authoring changes.

## Implementation

Use the tables above as the conceptual reference when reasoning about field behavior, choosing a mark type, or explaining a filter dialog. They map each role/type/datatype/mark/zone to its meaning and visible effect in Desktop. For the exact XSD enum values these correspond to in workbook XML (mark-type tokens, zone-type strings, filter classes, CI suffixes), see `expertise://tableau/tactics/tree/enums`.

## Source and Confidence

- Source/evidence type: published documentation
- Source: Tableau product documentation — field roles, mark types, data types, filter classes
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
