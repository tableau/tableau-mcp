# Visualization: Formatting & Professional Polish

Reference guide for transforming functional Tableau visualizations into polished, presentation-ready output. Covers color strategy, typography, gridlines, axis formatting, mark styling, white space, and common mistakes.

- Tags: formatting, typography, color, gridlines, polish

## Scope Check


- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: refine, format
- In-scope reason: Guides the agent on how to apply professional formatting rules when refining a dashboard for presentation readiness, using workbook XML edits for gridlines, fonts, number formats, mark borders, and white space.
- Out-of-scope risk: none
- Tags: formatting, typography, color, gridlines, polish, font-size, number-formatting, white-space, mark-borders, axis-formatting
- Relevant user prompts/search terms: "how to make my dashboard look professional", "remove gridlines Tableau", "font size recommendations", "number formatting with K and M", "dashboard looks cluttered", "presentation ready viz", "too many decimal places", "axis title best practices", "mark borders on stacked bars", "white space between charts"

## When to Use This Module

Apply these techniques when:
- Building a dashboard intended for stakeholders, executives, or public audiences
- Preparing a viz for Tableau Public, blog posts, or competition (Iron Viz, Viz of the Day)
- The user asks to "clean up", "polish", "make it look professional", or "presentation-ready"
- A viz is functionally correct but looks like a default Tableau output

Do NOT over-format when:
- The user is exploring data interactively (exploratory mode)
- Speed matters more than aesthetics (ad-hoc analysis)
- The viz is a throwaway prototype

## Best Practices

1. **Start with the defaults, then subtract.** Remove gridlines, borders, and axis titles before adding decoration. Professional vizzes have less chrome, not more.
2. **Every pixel should earn its place.** If an element does not help the viewer understand the data, remove it.
3. **Consistency is more important than any single choice.** A mediocre font used consistently beats three "perfect" fonts mixed together.
4. **Format numbers for the audience.** Executives want "1.2M", analysts want "1,234,567". Know your audience.
5. **Test at the final display size.** A dashboard that looks great at 1920x1080 may be unreadable on a laptop or embedded in a portal at 800x600.

## Color Palette Strategy

### Palette Types

| Type | Use When | Example |
|------|----------|---------|
| **Sequential** | Encoding a single continuous measure (low to high) | Revenue heat map, population density |
| **Diverging** | Data has a meaningful midpoint (positive/negative, above/below target) | Profit margin (red-white-green), YoY change |
| **Categorical** | Distinguishing discrete categories (max 7-8 colors) | Region, product category, segment |
| **Single hue + gray** | Highlighting one category against others | "Our company" vs competitors |

### When to Suppress Color Entirely

- When the viz has only one category and color adds no information
- When position already encodes the variable (a sorted bar chart does not need color to show rank)
- When you want to use color sparingly to highlight a single outlier or annotation

In these cases, use a single neutral color (`#4e79a7` or `#5b7fa5`) for all marks.

### Professional Hex Palettes

**Tableau 10 (default categorical -- already strong):**
`#4e79a7` `#f28e2b` `#e15759` `#76b7b2` `#59a14f` `#edc948` `#b07aa1` `#ff9da7` `#9c755f` `#bab0ac`

**Blue sequential (reports and finance):**
`#deebf7` `#9ecae1` `#4292c6` `#2171b5` `#084594`

**Red-Blue diverging (profit/loss, hot/cold):**
`#b2182b` `#ef8a62` `#fddbc7` `#f7f7f7` `#d1e5f0` `#67a9cf` `#2166ac`

**Corporate neutral (gray-forward, muted accents):**
`#333333` `#666666` `#999999` `#cccccc` `#4e79a7` `#e15759`

**Earth tones (editorial, infographic):**
`#5b4e3c` `#8c7853` `#b8a88a` `#d4c5a9` `#3e6f5e` `#7bab8e`

### Colorblind-Safe Options

Tableau ships several colorblind-safe palettes. Prefer these when the audience is broad or unknown:

- **Color Blind 10** -- built-in Tableau palette, 10 distinct hues optimized for deuteranopia/protanopia
- **Tableau 10** -- already reasonable for most colorblind types
- **Blue-Orange Diverging** -- safe diverging palette (avoid red-green diverging)

Rules of thumb:
- Never rely on red vs green as the only distinguishing signal
- Pair color with shape, label, or position as a secondary encoding
- Test with a simulator (e.g., Coblis or the built-in Tableau color blindness checker)

### Workbook XML: Custom Color Palettes

Custom palettes live in `<preferences> → <color-palette>`:

```xml
<preferences>
  <color-palette name="Corporate Blues" type="ordered-sequential">
    <color-palette-entry>#deebf7</color-palette-entry>
    <color-palette-entry>#9ecae1</color-palette-entry>
    <color-palette-entry>#4292c6</color-palette-entry>
    <color-palette-entry>#2171b5</color-palette-entry>
    <color-palette-entry>#084594</color-palette-entry>
  </color-palette>
</preferences>
```

Palette `type` values: `regular` (categorical), `ordered-sequential`, `ordered-diverging`.

## Typography & Text

### Recommended Font Sizes

| Element | Size | Weight | Notes |
|---------|------|--------|-------|
| Dashboard title | 18-22pt | Bold | One per dashboard, top-left or centered |
| Subtitle / description | 12-14pt | Regular | Brief context, data source, or date range |
| Sheet title | 14-16pt | Bold | Only if the sheet is standalone on a dashboard |
| Axis title | 10-12pt | Regular | Often better to remove and let the axis labels speak |
| Axis tick labels | 9-11pt | Regular | Must be readable at final display size |
| Mark labels | 8-10pt | Regular | Use sparingly -- only when the exact number matters |
| Tooltip header | 11-13pt | Bold | First line in tooltip |
| Tooltip body | 10-12pt | Regular | Keep to 3-4 lines max |
| Annotations | 9-11pt | Italic or Regular | Callout text for specific marks |

### Font Family Recommendations

- **Tableau Book / Tableau Regular** -- the built-in default. Clean, purpose-built for data viz. Use this unless the organization mandates a brand font.
- **Benton Sans** -- Tableau's alternate built-in. Slightly more modern feel.
- **Trebuchet MS** -- good cross-platform fallback, similar to Tableau Book.
- **Arial / Helvetica** -- safe corporate fallback. Slightly less character than Tableau fonts.

Avoid: Times New Roman (too formal/academic), Comic Sans (obvious), Calibri (looks like an Excel export), decorative fonts.

### Font Color

- Primary text: `#333333` (not pure black -- too harsh against white)
- Secondary text (axis labels, captions): `#666666`
- De-emphasized text (source notes): `#999999`
- Avoid colored text for data labels -- let the marks carry the color

### Workbook XML: Style Rules for Fonts

Worksheet-level formatting lives in `<style-rule>` elements under the worksheet's `<style>` element:

```xml
<style>
  <style-rule element="worksheet-title">
    <format attr="font-size"   value="18"/>
    <format attr="font-weight" value="bold"/>
    <format attr="color"       value="#333333"/>
  </style-rule>
</style>
```

Common `element` values for `style-rule`:
- `worksheet` -- base worksheet formatting
- `worksheet-title` -- the sheet title text
- `axis-title` -- axis title text
- `axis-labels` -- axis tick labels
- `label` -- mark labels
- `tooltip` -- tooltip text
- `header` -- row/column header text
- `cell` -- table/crosstab cell text

## Gridlines, Axes & Borders

### Gridlines: When to Remove

| Chart Type | Gridlines? | Rationale |
|------------|-----------|-----------|
| Bar chart (horizontal) | Remove all | The bar length IS the value. Gridlines are redundant. |
| Bar chart (vertical) | Remove vertical, keep light horizontal if bars are tall | Helps the eye track across tall bars |
| Line chart | Keep light horizontal | Helps estimate values at time points |
| Scatterplot | Keep both, light | Necessary for estimating position in 2D |
| Map | Remove all | Grid on a map is visual noise |
| Treemap | Remove all | Marks fill the space; grid is meaningless |
| Pie / donut | Remove all | No axes to grid against |
| Heatmap / highlight table | Remove all | Cell color carries all information |
| Bullet / reference lines | Keep the reference line; remove grid | The reference line replaces the grid's function |

### Gridline Styling When Kept

- Color: `#e8e8e8` or `#ececec` (very light gray -- never black or dark gray)
- Style: solid, 1px width
- Zero line: slightly darker (`#cccccc`) or same as gridline -- avoid bold black zero lines

### Workbook JSON: Gridline and Zero Line Formatting

Gridline formatting is controlled via `style-rule` elements with `element="gridline"` or `element="zeroline"`:

```xml
<style-rule element="gridline">
  <format attr="line-visibility" value="off"/>
</style-rule>
```

To make gridlines light instead of removing:

```xml
<format attr="line-color" value="#e8e8e8"/>
<format attr="line-size"  value="0"/>
```

### Axis Formatting

**Remove unnecessary axis titles.** If the axis labels make the measure obvious (e.g., "Jan, Feb, Mar" on the x-axis), the title "Month" adds nothing. Same for "$0K, $50K, $100K" -- the dollar sign and K suffix already say "revenue".

**Number formatting best practices:**

| Range | Format | Example |
|-------|--------|---------|
| 0 - 999 | Whole number | `742` |
| 1,000 - 999,999 | K suffix, 0-1 decimal | `1.2K`, `850K` |
| 1,000,000 - 999,999,999 | M suffix, 1 decimal | `4.5M`, `120M` |
| 1B+ | B suffix, 1-2 decimals | `2.3B` |
| Percentages | 0-1 decimal, % symbol | `45.2%` (not `0.452`) |
| Currency | $ prefix, K/M/B suffix | `$1.2M` |
| Dates (axis) | Shortest unambiguous | `Jan '24` or `2024-Q1` |
| Dates (tooltip) | Full readable | `January 15, 2024` |

**Axis line visibility:** Remove the axis line itself (the solid line along the axis) when gridlines are present. It is redundant.

### Workbook XML: Number Formatting

Number formatting is set in the column definition within the datasource using the `format` attribute, or overridden at the worksheet level:

```xml
<column datatype="real" name="[Sales]" role="measure" type="quantitative">
  <format attr="format" value="$#,##0.0K"/>
</column>
```

## White Space & Layout

### Dashboard Padding and Margins

White space separates elements and lets the eye rest. Cramped dashboards look amateur.

| Area | Recommended Padding |
|------|-------------------|
| Outer dashboard margin | 10-16px all sides |
| Between adjacent sheets | 8-12px |
| Between title and first sheet | 6-10px |
| Inside filter containers | 4-8px inner padding |
| Between legend and chart | 8px |

### Layout Principles

1. **Align to a grid.** Use Tableau's layout containers (horizontal/vertical) to enforce alignment. Misaligned elements are the single biggest tell of an amateur dashboard.
2. **Left-align text.** Centered text is harder to scan, especially for titles and labels. Exception: a single dashboard title can be centered.
3. **Group related elements.** Filters for a sheet should be visually proximate to that sheet. Do not scatter filters across the dashboard.
4. **Visual hierarchy through size.** The most important chart gets the most space. Supporting charts and KPIs get less.
5. **Fixed-size dashboards** (1200x800, 1366x768, or 1920x1080) give you more control than "Automatic" sizing, which can cause unpredictable reflows.

### Workbook XML: Zone Padding

Dashboard zone padding is set in `<zone-style> → <format>` elements:

```xml
<zone id="5" type-v2="layout-basic">
  <zone-style>
    <format attr="padding" value="12"/>
    <format attr="margin"  value="8"/>
  </zone-style>
</zone>
```

## Mark Borders & Opacity

### When to Add Mark Borders

| Scenario | Border? | Settings |
|----------|---------|----------|
| Stacked bars | Yes | Thin white border (`#ffffff`, 1px) to separate segments |
| Treemaps | Yes | White or light gray border to define cell boundaries |
| Packed bubbles | Yes | Light border helps distinguish overlapping circles |
| Simple bar chart | No | Clean edge is sufficient |
| Line chart | No | Border on lines looks strange |
| Scatterplot | Optional | Helps when points overlap; use 0.5px |
| Area chart | Yes | Thin border on the top edge of the area to define the line |

### Opacity Settings

- **Default marks:** 100% opacity for bar charts, lines. 60-80% for scatter plots to reveal overlap.
- **Highlighted state:** 100% opacity for the highlighted mark.
- **Dimmed / context marks:** 15-25% opacity. This creates the "highlight" effect without removing data.
- **Overlapping areas:** 40-60% opacity so underlying areas show through.

### Workbook XML: Mark Styling

Mark border and opacity are set via `<style-rule element="mark">` inside the pane's `<style>` element (see `workbook-encodings.md`):

```xml
<style>
  <style-rule element="mark">
    <format attr="has-stroke"        value="true"/>
    <format attr="stroke-color"      value="#ffffff"/>
    <format attr="mark-transparency" value="38"/>
  </style-rule>
</style>
```

`mark-transparency`: `"0"` = fully opaque; `"38"` ≈ 15%; `"128"` ≈ 50%; `"255"` = fully transparent.

## Common Mistakes

### 1. Rainbow Colors
Using a full-spectrum rainbow palette for categorical data. The human eye does not perceive rainbow colors as ordered, so it fails as both sequential and categorical encoding. Use Tableau's built-in palettes instead.

### 2. Too Many Decimal Places
Showing `$1,234,567.89` on an axis when `$1.2M` communicates the same insight. Extra precision creates visual clutter and slows comprehension. Rule: use the fewest decimals that preserve the needed accuracy.

### 3. Cluttered Gridlines
Leaving default dark gridlines on bar charts. This is the most common "I didn't format this" signal. Remove them or make them very light.

### 4. Inconsistent Formatting
Using different fonts, colors, or number formats across sheets in the same dashboard. The viewer's brain spends effort parsing the format instead of the data. Define a style once and apply it everywhere.

### 5. Meaningless Color
Coloring bars by the same dimension already on the axis (e.g., bars sorted by category AND colored by category). This uses color to encode information that is already encoded by position. Remove the color or use it for a second variable.

### 6. Axis Overload
Showing both axis labels AND mark labels. Choose one. If the viewer needs exact numbers, use mark labels and remove the axis. If they need approximate comparison, keep the axis and remove mark labels.

### 7. Default Tooltips
Leaving the auto-generated tooltip with every field in the view. Tooltips should be curated: a clear title, the 2-3 most relevant values, and proper formatting. Remove "SUM(Sales)" and replace with "Total Sales: $1.2M".

### 8. Gray Backgrounds
Using gray worksheet or dashboard backgrounds. White (`#ffffff`) or very light off-white (`#fafafa`) provides maximum contrast and a clean look. Dark dashboards can work but require expertise with text contrast.

### 9. Unaligned Elements
Dashboard objects placed by eye instead of snapped to containers. Misalignment of even 2-3 pixels is subconsciously perceived as sloppy. Use layout containers and padding, not freeform placement.

### 10. Chart Junk
Adding data labels, gridlines, borders, legends, AND color encoding all at once. Each additional element competes for attention. The "Iron Viz look" comes from removing elements, not adding them.

## The Gap: Functional vs. Iron Viz Quality

| Dimension | Functional (Default) | Professional Polish |
|-----------|---------------------|-------------------|
| Color | Default Tableau 10, applied to everything | Restrained palette; color only where it adds meaning |
| Gridlines | Default gray lines on every chart | Removed on most charts; very light where kept |
| Fonts | Mixed sizes, default Tableau font at default sizes | Consistent hierarchy (title > subtitle > label) |
| Numbers | Raw values with 2+ decimals | Abbreviated with appropriate suffixes |
| White space | Sheets crammed edge-to-edge | Generous padding; visual breathing room |
| Tooltips | Auto-generated field dumps | Curated 2-3 line tooltips with formatted values |
| Axis titles | "SUM(Sales)" on every axis | Removed when redundant; renamed when kept |
| Legends | Large, auto-placed | Compact, positioned near relevant chart |
| Borders | Default cell borders visible | Removed or replaced with white space |
| Titles | "Sheet 1", "Sheet 2" | Descriptive, insight-driven ("Revenue grew 23% in Q4") |

The professional version is almost always achieved by **removing defaults** rather than adding decoration. Think of formatting as sculpture: start with the block and carve away.

## Implementation in Tableau Desktop

### Workflow for Polishing a Dashboard

1. **Start with `tableau-list-worksheets`** to understand the current structure.
2. **Use `tableau-get-workbook`** to get the cached workbook XML file path (e.g. `cache/workbook-XXXX.xml`).
3. **Modify the XML** using Python scripts (`xml.etree.ElementTree`) to apply formatting changes in bulk:
   - Add/modify `<style-rule>` elements in each worksheet's `<style>` section
   - Update `<format>` elements for number formatting in datasource columns
   - Adjust `<zone-style>` → `<format>` elements for dashboard padding
   - Set mark encoding attributes for borders and opacity
4. **Apply with `tableau-apply-workbook`** passing the modified file path.
5. **Verify visually** using screen capture or by asking the user to confirm.

### Bulk Formatting Script Pattern

```python
import xml.etree.ElementTree as ET

ET.register_namespace('', '')  # preserve existing namespaces
tree = ET.parse('cache/workbook-XXXX.xml')
root = tree.getroot()

# Find all worksheets and apply formatting
for ws in root.iter('worksheet'):
    style_node = ws.find('style')
    if style_node is None:
        style_node = ET.SubElement(ws, 'style')
        ws.insert(0, style_node)  # style is typically the first child

    # Remove gridlines
    gridline_rule = ET.SubElement(style_node, 'style-rule')
    gridline_rule.set('element', 'gridline')
    fmt = ET.SubElement(gridline_rule, 'format')
    fmt.set('attr', 'line-visibility')
    fmt.set('value', 'off')

    # Set title font
    title_rule = ET.SubElement(style_node, 'style-rule')
    title_rule.set('element', 'worksheet-title')
    for attr, val in [('font-size', '16'), ('font-weight', 'bold'), ('color', '#333333')]:
        fmt = ET.SubElement(title_rule, 'format')
        fmt.set('attr', attr)
        fmt.set('value', val)

tree.write('/tmp/workbook-formatted.xml', encoding='utf-8', xml_declaration=True)
```

### Key XML Nodes for Formatting

| What to Format | Where in Workbook XML |
|---------------|----------------------|
| Gridlines | `worksheet > style > style-rule[element=gridline]` |
| Zero lines | `worksheet > style > style-rule[element=zeroline]` |
| Axis titles | `worksheet > style > style-rule[element=axis-title]` |
| Axis labels | `worksheet > style > style-rule[element=axis-labels]` |
| Mark labels | `worksheet > style > style-rule[element=label]` |
| Sheet title | `worksheet > style > style-rule[element=worksheet-title]` |
| Tooltip text | `worksheet > style > style-rule[element=tooltip]` |
| Number format | `datasource > column > format[@attr=format]` |
| Mark borders | `worksheet > pane > style > style-rule[element=mark] > format[@attr=has-stroke/stroke-color]` |
| Mark opacity | `worksheet > pane > style > style-rule[element=mark] > format[@attr=mark-transparency]` |
| Dashboard padding | `dashboard > zones > zone > zone-style > format[@attr=padding]` |
| Custom palettes | `preferences > color-palette > color-palette-entry` |
| Mark color (uniform) | Edit `<mark>` element's `<encodings>` in the pane: add `<color>` with a fixed hex value attribute, or remove field-driven color |
| Mark color (by field) | `worksheet > pane > encodings > color` element with `column` attribute referencing CI |

## Examples

### Example 1: Clean Bar Chart Style Rules

Remove gridlines, lighten axis labels, bold the title:

```xml
<style>
  <style-rule element="gridline">
    <format attr="line-visibility" value="off"/>
  </style-rule>
  <style-rule element="zeroline">
    <format attr="line-visibility" value="off"/>
  </style-rule>
  <style-rule element="axis-labels">
    <format attr="font-size" value="10"/>
    <format attr="color"     value="#666666"/>
  </style-rule>
  <style-rule element="worksheet-title">
    <format attr="font-size"   value="18"/>
    <format attr="font-weight" value="bold"/>
    <format attr="color"       value="#333333"/>
  </style-rule>
</style>
```

### Example 2: Scatterplot with Light Gridlines

Keep gridlines but make them nearly invisible:

```xml
<style>
  <style-rule element="gridline">
    <format attr="line-color" value="#ececec"/>
    <format attr="line-size"  value="0"/>
  </style-rule>
  <style-rule element="zeroline">
    <format attr="line-color" value="#cccccc"/>
    <format attr="line-size"  value="0"/>
  </style-rule>
</style>
```

### Example 3: Stacked Bar with White Borders

Inside the pane's `<style>` element:

```xml
<style>
  <style-rule element="mark">
    <format attr="has-stroke"   value="true"/>
    <format attr="stroke-color" value="#ffffff"/>
  </style-rule>
</style>
```

### Example 4: Dashboard Zone with Proper Padding

```xml
<zone-style>
  <format attr="padding"      value="12"/>
  <format attr="margin"       value="8"/>
  <format attr="border-color" value="#ffffff"/>
  <format attr="border-style" value="none"/>
</zone-style>
```

## Source and Confidence

- Source/evidence type: design best-practice
- Source: Visualization formatting best practice (palettes, typography, gridlines, white space) applied to Tableau
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
