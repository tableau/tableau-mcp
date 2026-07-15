# Tableau Field & Mark Type Reference

Quick-reference tables for Tableau field roles, data types, mark types, dashboard zone types, and filter classes.

---

## When to Use This Module

Use this guide when:

- **A customer asks why a field behaves differently than expected** and you need to check role, type, or datatype
- **Choosing a mark type** for a chart type discussion
- **Explaining dimensions vs. measures** or discrete vs. continuous fields
- **Troubleshooting filter dialog options** that differ from what a customer expects

For exact workbook XML enum values, see `expertise://tableau/tableau-tactics/tree/enums`.

---

## Field Roles

| Role | Behavior | Default pill color |
|---|---|---|
| **Dimension** | Slice and group data; categorical | Blue |
| **Measure** | Aggregate values; numeric | Green |

A field's role determines the default aggregation behavior and which shelf options are available. Right-click any field in the Data pane and choose Change to Dimension or Change to Measure to override.

---

## Field Types (Discrete vs. Continuous)

| Type | Behavior | Pill color |
|---|---|---|
| **Discrete** (nominal / ordinal) | Creates headers; values listed | Blue |
| **Continuous** (quantitative) | Creates axes; values on a scale | Green |

The type is independent of the role. You can have a discrete measure, such as `RANK()` on Rows as a discrete blue pill, or a continuous dimension, such as a date on Columns as a continuous green axis.

Right-click a pill on a shelf and choose Convert to Discrete or Convert to Continuous.

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

Tableau infers the data type from the source. You can change it in the Data pane by right-clicking the field and choosing Change Data Type.

---

## Mark Types

| Mark type | Typical chart |
|---|---|
| **Automatic** | Tableau chooses based on what is on the shelves |
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

Change the mark type from the dropdown at the top of the Marks card.

Tableau's Automatic selection is correct for many standard charts: Bar when comparing categories, Line when dates are on Columns, and Circle for scatter. Override it manually when you need a specific type that Automatic would not choose, such as forcing Line when Tableau auto-selects Bar for discrete dates or using Gantt Bar for timeline work.

---

## Filter Classes

| Filter class | When it appears |
|---|---|
| **Categorical** | Dimension filter: check boxes or dropdown to include/exclude members |
| **Quantitative (range)** | Measure filter or continuous date filter: min/max slider |
| **Relative date** | Date dimension filter: "last N days/weeks/months" |
| **Top N** | Dimension filter -> Top tab: limit to top/bottom N by a measure |

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

---

## Common Mistakes

1. **Treating this guidance as generic enablement rather than Tableau authoring guidance.**
2. **Applying the pattern without checking whether it fits the dashboard, visualization, or workbook context.**
3. **Skipping validation in Tableau after making authoring changes.**

---

## Implementation

Use the tables above as the conceptual reference when reasoning about field behavior, choosing a mark type, or explaining a filter dialog. They map each role, type, datatype, mark, and zone to its meaning and visible effect in Tableau Desktop.

For the exact XSD enum values these correspond to in workbook XML, such as mark-type tokens, zone-type strings, filter classes, and column-instance suffixes, see `expertise://tableau/tableau-tactics/tree/enums`.

---

## Source and Confidence

- Source/evidence type: published documentation
- Source: Tableau product documentation - field roles, mark types, data types, filter classes
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
