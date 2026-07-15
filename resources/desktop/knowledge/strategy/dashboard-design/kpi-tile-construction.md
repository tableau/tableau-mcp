# KPI Tile Construction Pattern

SE knowledge entry for field expertise that may later be reviewed for promotion into the Tableau authoring expertise layer.

## Scope Check

- Primary audience: SE assisting a Tableau user
- Authoring outcome improved: create, format
- In-scope reason: Defines the field-tested 3-sheet container pattern for building KPI summary tiles that include a BAN, directional trend indicator, and sparkline — so Claude can guide users building the top KPI row of a dashboard correctly.
- Out-of-scope risk: none
- Tags: dashboard, KPI, BAN, sparkline, trend, container, layout, authoring-pattern
- Relevant user prompts/search terms: "how do I build a KPI tile", "big number with trend arrow", "sparkline next to BAN", "how many KPI tiles in a row", "arrow color green or red", "when to skip the trend line", "KPI summary row best practice"

## When to Use

Use this guidance when a customer is:

- Building the top KPI summary row of a dashboard
- Asking how to show a big number with a trend indicator alongside it
- Trying to combine a BAN, an up/down arrow, and a sparkline in one tile
- Asking how to color an arrow green or red based on whether the trend is good or bad

This applies to:

- Any Tableau dashboard with a KPI summary section
- Operational, financial, and executive dashboards where headline metrics drive decisions

## Best Practices

### KPI Tile Row Rules

- **Maximum 5 KPI tiles** in the top summary row. More than 5 tiles compress each tile to the point where the numbers and sparklines become unreadable.
- Each tile should represent a metric that is **primary to the dashboard's audience** — not every available metric. If a metric does not drive a decision for the intended viewer, it does not belong in the top row.
- Tiles should be **equal width** across the row, distributed evenly in a horizontal layout container.

### The 3-Sheet KPI Tile

Each KPI tile is built from up to three sheets inside a vertical container:

```
Vertical container (one tile)
├── Horizontal container
│   ├── Sheet 1: BAN (the primary metric number)
│   └── Sheet 2: Up/down arrow (trend direction, colored green/red)
└── Sheet 3: Trend line / sparkline (omit if no history available)
```

#### Sheet 1 — BAN

- Displays the primary metric value at large font size (24–48pt)
- Minimal decoration: no axes, no gridlines, no borders
- Label/title at 10–14pt below or above the number

#### Sheet 2 — Directional Arrow

- Separate sheet for clean color control independent of the BAN
- Use a shape mark (up/down triangle or arrow character) sized to be clearly visible next to the BAN
- Color encoding:
  - **Green** = favorable trend (good)
  - **Red** = unfavorable trend (bad)
- Place Sheet 2 immediately to the right of Sheet 1 inside the horizontal container
- The definition of "good" vs. "bad" depends on the metric — for revenue, up is green; for cost or exceptions, up is red. Define this explicitly in the calculated field driving the color.

#### Sheet 3 — Trend Line / Sparkline

- A compact line chart showing the metric over the available historical period
- Sits below the horizontal container (Sheet 1 + Sheet 2) in the vertical tile container
- Time grain adapts to the dataset: use monthly for 12+ months of history, weekly or daily for shorter windows
- **Omit Sheet 3 entirely** when the data has no meaningful history — for example, active pipeline data, current-state snapshots, or any dataset where a time series would be misleading or empty. Do not show a blank or near-empty sparkline.

### When to Say No

Say no when a customer wants to add a sparkline to a tile but the underlying data has no history or only a single time period.

Recommended wording:

> A trend line only adds value when there is enough history to show a meaningful pattern. With only current-state data, a sparkline would be empty or misleading. Let's keep this tile as a BAN with the directional arrow and skip the trend line — that tells the story cleanly without implying history that isn't there.

Offer this instead:

- A 2-sheet tile (BAN + arrow) without the sparkline
- A text indicator showing the comparison period (e.g., "vs. prior month") instead of a full trend line

## Common Mistakes

- **Embedding the arrow in the BAN sheet.** Coloring a shape inside the same sheet as the BAN forces you to fight Tableau's color encoding on the primary measure. Separate sheets give clean, independent color control.
- **More than 5 tiles in the top row.** At 6+ tiles the numbers shrink, the sparklines become unreadable lines, and the row stops communicating. Push additional metrics down the page or to a secondary tab.
- **Showing a sparkline when there is no history.** An empty or near-empty trend line signals broken data to the viewer. Omit Sheet 3 explicitly when history is unavailable.
- **Using the same color direction for every metric.** Green-up works for revenue but is wrong for cost, errors, or risk. Define good/bad direction per metric in the calculated field, not as a global rule.
- **Uneven tile widths.** If tiles are different widths, the row looks unbalanced and implies some metrics are more important than others without intent. Use an evenly distributed horizontal container.

## Implementation

To build a KPI tile row:

1. Decide which metrics belong in the top row (maximum 5). Each must be primary to the dashboard's audience.
2. For each tile, create three sheets:
   - **Sheet 1 (BAN)**: Single measure, Text or Square mark, large font, no axes or gridlines.
   - **Sheet 2 (Arrow)**: Shape mark driven by a calculated field that returns `"up"` or `"down"` based on period-over-period change. Assign a color calculation: green for favorable, red for unfavorable. Size the shape to align visually with the BAN.
   - **Sheet 3 (Sparkline)**: Line mark on the measure over time. Remove all axes, gridlines, headers, and labels. Keep it minimal — just the line shape.
3. Build the container structure:
   - Create a vertical layout container for the tile.
   - Inside it, add a horizontal layout container containing Sheet 1 and Sheet 2.
   - Below the horizontal container, add Sheet 3 (only if historical data exists).
4. Duplicate the tile container across the row for each KPI.
5. Place all tile containers inside a top-level horizontal layout container set to distribute evenly.
6. If the dataset has no history for a given metric, use only the 2-sheet version (Sheet 1 + Sheet 2, no vertical container needed).

## Source and Confidence

- Source: mschley — field-tested managing 500–700 Tableau dashboards at a major US bank
- Source/evidence type: SE field experience
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-01
