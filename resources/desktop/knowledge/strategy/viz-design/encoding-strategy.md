# Marks, Encodings & Chart Configuration

Strategy guide for the Tableau marks card — *which* encoding channel to use and *why*, mark-type selection, label display decisions, color strategy, and when each chart-specific pattern (Gantt, maps, dual-axis) is the right call.

Tags: marks, encodings, mark-types, color, labels

**Tactics companion:** `expertise://tableau/tactics/viz/marks-and-encodings` — the XML/authoring mechanics for this topic.

## Scope Check


- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: create, refine, troubleshoot
- In-scope reason: This guides Claude when assigning fields to visual channels like color and size, configuring labels, and building chart-specific patterns such as Gantt charts or dual-axis views for Tableau dashboards.
- Out-of-scope risk: none
- Tags: marks, encodings, mark-types, color, labels, size, detail, tooltip, gantt, dual-axis, maps, choropleth
- Relevant user prompts/search terms: "what should I put on the Color shelf", "how to add labels to marks", "Gantt chart configuration", "dual axis chart setup", "filled map color encoding", "mark size not showing", "tooltip customization", "Detail shelf vs aggregation", "Line vs Bar mark type", "when to use continuous vs discrete dates"

## When to Use

Use this guide when:
- **Assigning a field to a visual channel** — color, size, shape, text/label, detail, tooltip
- **Changing the mark type** — Bar, Line, Circle, Area, GanttBar, Pie, Text, etc.
- **Configuring label display** — enabling mark labels, styling font/color, controlling position
- **Setting a custom color palette** — continuous diverging or sequential
- **Building a Gantt chart** with a size encoding for duration
- **Creating a dual-axis chart** with two mark types overlaid
- **Adding a filled map (choropleth)** with color encoding
- **Controlling aggregation level** — aggregate mode vs. one mark per row

---

## Encoding Channels (Marks Card)

The marks card exposes these encoding channels:

| Channel | What it does | Typical field type |
|---|---|---|
| **Color** | Encodes a field using hue or a sequential/diverging palette | Dimension (categorical) or Measure (continuous) |
| **Size** | Scales mark size by a measure | Measure |
| **Text / Label** | Displays a field value as a text label on each mark | Measure or Dimension |
| **Detail** | Adds granularity without a visible encoding (increases mark count) | Dimension |
| **Tooltip** | Adds fields to the hover tooltip without placing them on the view | Any |
| **Shape** | Encodes a dimension with distinct shapes | Dimension (low cardinality — up to ~25 shapes) |
| **Path** | Controls the order marks are connected for Line charts | Dimension or Date |

**Detail channel note:** placing a dimension on Detail increases the view's level of detail — useful when you need one mark per entity (e.g., Order ID) without encoding that field visually. This is the mechanism behind scatter plot granularity control and data densification patterns.

---

## Mark Types

Change via the mark type dropdown at the top of the marks card:

| Mark type | Typical use |
|---|---|
| **Automatic** | Tableau chooses based on shelf configuration |
| **Bar** | Categorical comparisons |
| **Line** | Time series, trends |
| **Area** | Stacked or filled time series |
| **Circle** | Scatter plots, dot plots |
| **Square** | Filled square marks |
| **Shape** | Shape-encoded scatter |
| **Text** | Text tables, BAN numbers |
| **Pie** | Part-to-whole (use sparingly; max ~6 slices) |
| **Gantt Bar** | Timeline / project schedule charts |
| **Polygon** | Custom shape outlines |

**Automatic** is appropriate for most cases — Tableau selects Bar when a dimension is on one axis and a measure on the other, Line when a date is on Cols, etc. Manually override when you need a specific type (e.g., force Circle for a scatter with a date axis that Tableau would auto-render as Line).

---

## Color Encoding

**Categorical (dimension on Color):** Tableau assigns one color per member. Open the color legend → **Edit Colors** to change palette or assign specific colors.

**Continuous (measure on Color):** Tableau uses a sequential or diverging palette. Double-click the color legend → select a palette → adjust start/end colors and the range.

**Fixed colors per member:** right-click a mark in the view → **Mark Color** to pin a specific color to one member regardless of the palette.

**Colorblind accessibility:** in Edit Colors, Tableau offers Color Blind 10 as a built-in palette. Avoid encoding information with red vs. green alone.

---

## Size Encoding

Drag a measure to **Size** on the marks card. Tableau scales mark sizes proportionally to the measure.

Adjust the size range via the Size legend → drag the slider to widen or narrow the range. For bubble charts, a wider range makes small vs. large differences more legible.

**Fixed size (no encoding):** click **Size** on the marks card without a field dropped on it → use the slider to set a uniform size.

---

## Label / Text Encoding

Drag a field to **Text** or **Label** on the marks card to display values on each mark.

**Enable labels:** click the **Label** button on the marks card → check **Show mark labels**. This is separate from having a field on Text — both must be true for labels to appear.

**Label placement options:**
- **Automatic** — Tableau places labels to minimize overlap
- **Always show** — shows all labels, overlaps permitted
- **Never overlap** — suppresses labels that would overlap

**Label mode controls** (click Label → expand):
- **Line ends** — labels only at start and end of lines
- **Most recent** — label at the rightmost time point (Line marks only)
- **Min/Max** — labels at the minimum and maximum values

**Label font and color:** click **Label** → **Font** to change family, size, and weight. **Color-mode: match** inherits the mark color; otherwise set an explicit color.

---

## Tooltip Encoding

Add fields to Tooltip on the marks card to include them in hover tooltips without placing them in the view.

**Customize tooltip text:** click **Tooltip** on the marks card → edit the tooltip text. You can format it with HTML-like styling (bold, font size, color) and control which fields appear and in what order. The default auto-generated tooltip shows all fields in the view — customize it to show only the 2-3 most meaningful values with plain-language labels.

**Viz in Tooltip:** insert a sheet reference into the tooltip to display a linked mini-viz on hover. Use Insert → Sheet in the tooltip editor.

---

## Continuous vs Discrete Dates on Time-Series Axes

For line/area charts over time, continuous date is almost always better:

| | Discrete date | Continuous date |
|---|---|---|
| Pill color | Blue (dimension) | Green (measure) |
| Axis type | Category ticks per period | True continuous time axis |
| Gaps | None — all periods shown equally | Shows true time spacing |
| Best for | Ranked/ordinal comparisons | Trends, time series |

Right-click a date pill → toggle between discrete and continuous (or drag and drop to switch).

---

## Gantt Chart Pattern

Mark type: **Gantt Bar**

Standard layout:
- **Cols:** continuous date (truncated to day or hour) — controls bar start position
- **Rows:** dimension — one row per category/entity
- **Size encoding:** duration measure — controls bar length
- **Color encoding:** optional status or category field

The size encoding is what makes bars extend — without a measure on Size, all Gantt bars have zero length.

**Date truncation tip:** use `DATETRUNC('day', [Start Date])` as a calculated field so the bars align to day boundaries.

---

## Filled Map (Choropleth)

Requirements:
- A geographic dimension with geographic role assigned (State, Country, ZIP Code, etc.)
- Assign the role: right-click the field in the Data pane → **Geographic Role** → select the appropriate type

**Build the map:** double-click the geographic dimension — Tableau automatically places it on Rows/Cols as Latitude/Longitude generated fields and sets mark type to Map. Drop a measure on Color to create a choropleth.

**Color tuning:** double-click the color legend → adjust start color, end color, and the stepped/continuous setting. For diverging maps (positive/negative), choose a diverging palette with a center value at 0.

**Tooltip on maps:** especially important — the tooltip is often the only way to show the exact value for a region. Customize it to include the region name and the measure.

---

## Dual-Axis Chart

A dual-axis chart overlays two mark types on the same axis (e.g., Line + Circle, Bar + Line).

**Build:**
1. Place two measures on Rows (or Cols)
2. Right-click the second measure's axis → **Dual Axis**
3. Right-click again → **Synchronize Axis** if you want matching scales
4. Change the mark type for each measure independently using the per-measure mark card (two separate mark cards appear when dual axis is active)

**Common uses:**
- Line (trend) + Circle (individual data points) — emphasizes both trend and values
- Bar (actuals) + Line (target/average) — budget vs. actual comparisons
- Bump chart: dual axis with the same calc twice, reversed axis for rank-at-top

**Axis reversal** for rank charts: right-click the rank axis → **Edit Axis** → check **Reversed**.

---

## Reference Lines

Add a reference line to contextualize marks against a target or average.

**Add:** right-click the axis → **Add Reference Line** → choose:
- **Line:** constant value, field value (average, median, etc.), or parameter
- **Band:** shaded region between two values
- **Distribution:** percentile bands or standard deviation bands

Set the label to **None**, **Value**, or **Custom** text. For clean dashboards, minimizing reference line labels reduces clutter — let the line speak visually.

---

## Best Practices

- **Use color to encode one variable, not to decorate.** Color on a bar chart that also uses position for the same variable wastes a channel. Assign color to a *different* variable.
- **Prefer fewer encoding channels.** Each channel added competes for attention. Position (x/y) + one secondary channel (color or size) is usually enough.
- **Continuous dates for trends, discrete for period comparisons.** A continuous date axis shows true time spacing; discrete treats all periods as equal width.
- **Enable mark label culling to avoid clutter.** When showing labels on all marks, Tableau can suppress overlapping labels automatically — leave this enabled except on intentionally sparse views.
- **Gantt bars need both a date on Cols and a duration on Size.** Missing either makes bars invisible.
- **Don't encode the same variable on two channels simultaneously** (e.g., bar length AND color both = Sales). Use the second channel for a different measure or dimension.

---

## Common Mistakes

1. **No labels showing despite a field on Text.** Labels require two things: a field on the Text encoding AND the Label button set to "Show mark labels." Having only one isn't enough.
2. **Map not coloring correctly.** If Tableau isn't recognizing geographic values, the geographic role may not be set. Right-click the field → Geographic Role → assign the correct type.
3. **Gantt bars all zero-length.** No field is on the Size encoding. Drop the duration measure onto Size.
4. **Dual-axis scales not aligned.** After creating a dual axis, right-click the secondary axis → Synchronize Axis so both axes share the same scale. Without synchronization, visual comparisons are misleading.
5. **Using Area mark for overlapping series without opacity.** Multiple area series on the same pane overlap and obscure each other. Set opacity to 40-60% via Marks card → Color → Opacity, or use a stacked area (Analysis → Stack Marks → On).
6. **Color palette not updating for all marks.** If the color palette looks wrong after changing it, check whether the view has multiple mark cards (dual axis creates separate mark cards per measure — each needs to be updated independently).

---

## Implementation

Work the decision in this order: (1) pick the mark type for the question, (2) assign each variable to the channel that reads best (position > length > color/size), (3) decide labels and reference lines for the *one* number that matters. For the XML node structure behind any of these, see the tactics companion above, then verify the result in Tableau.

## Source and Confidence

- Source/evidence type: SME-authored reference
- Source: Tableau marks/encodings best practice (color, size, label, dual-axis, map) from product docs and SE field practice
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
