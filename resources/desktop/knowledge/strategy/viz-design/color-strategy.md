# Color Strategy for Data Visualizations

A guide for choosing and applying color in Tableau dashboards — covering palette types, accessibility, and Tableau-specific implementation. Grounded in Lisa Charlotte Muth's "Your Friendly Guide to Colors in Data Visualisation" (Datawrapper Blog).

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: format, refine
- In-scope reason: Helps Claude choose and apply accessible, meaningful color in Tableau dashboards when authoring.
- Out-of-scope risk: none
- Tags: color, palettes, accessibility, formatting, design
- Relevant user prompts/search terms: "how to choose colors for my dashboard", "colorblind safe palette Tableau", "too many colors on my chart", "sequential vs diverging palette", "why is my dashboard so busy", "red green colorblind problem", "text contrast on colored background", "grey for non-highlighted marks", "legend too far from chart", "brand colors in Tableau"

## When to Use

Use this guide when:
- **A customer asks why their dashboard looks busy or confusing** — often a color problem
- **Choosing between palette types** for a specific chart or map
- **A dashboard uses too many colors** and needs to be simplified
- **Designing for accessibility** or a colorblind audience
- **Coaching a customer on brand color integration** without sacrificing readability

---

## The Two Palette Types

Every color decision in data vis falls into one of two cases. Getting this wrong is the most common color mistake.

### Sequential / Diverging Palettes (for continuous data)

Use when data progresses from low to high — unemployment rates, sales totals, temperature readings.

Colors in a gradient communicate: *"I represent a value slightly higher or lower than the color next to me."*

| Palette Type | When to Use | Example |
|---|---|---|
| **Sequential** | One direction: low → high | Light blue → dark blue for sales density |
| **Diverging** | Two directions from a meaningful midpoint | Red → white → blue for profit (negative to positive) |

**Key requirement**: Steps must be visually distinct enough that the viewer can actually tell them apart. Subtle gradients that look beautiful in UI design are not sufficient for data — the viewer needs to read the difference between a light green and a slightly lighter green.

**In Tableau**: Drag a measure to Color on the marks card → Edit Colors → choose a sequential or diverging palette. Adjust the range to match your data's meaningful min/max, not the data's actual min/max.

### Categorical / Distinctive Palettes (for discrete categories)

Use when data has unordered categories — political parties, product lines, regions, customer segments.

Distinctive colors communicate: *"I am completely separate from all the other colors here."*

**Key requirement**: Colors must be visually distinguishable from each other and not imply any ordering or relationship between categories.

**In Tableau**: Drag a dimension to Color → Edit Colors → choose a qualitative palette (e.g., Tableau 10, Tableau 20, or a custom palette).

---

## Grey Is the Most Important Color

Grey makes everything else work. Used as the default color for non-highlighted marks, grey creates contrast that makes your one or two meaningful colors stand out.

**The grey principle in practice:**
- Make most marks grey by default
- Color only the marks that carry the insight
- The single colored element becomes the focal point automatically

This is more powerful than coloring everything differently. A bar chart where one bar is blue and eleven are grey communicates the ranking instantly. A bar chart where all twelve bars are different colors communicates nothing.

**In Tableau**: Set the default mark color to a medium grey (`#999999` or `#AAAAAA`). Use a calculated field to conditionally assign a highlight color to specific dimension members.

---

## Colorblindness Accessibility

Roughly 8% of men and 0.5% of women have some form of color vision deficiency. The most common is red-green colorblindness (deuteranopia).

**What breaks for colorblind viewers**:
- Red/green combinations — the single most common mistake
- Red/orange, green/yellow distinctions
- Low-contrast sequential palettes

**Tableau-safe defaults**:
- Use ColorBrewer palettes — they are designed to be colorblind-safe
- Avoid encoding meaning in red vs green alone — add a label, icon, or position cue
- The Tableau 10 default palette has known colorblindness issues; ColorBrewer's qualitative palettes are safer

**How to check**: Use a colorblindness simulator before sharing a dashboard. The Coblis simulator (online) or Sim Daltonism (Mac app) show your dashboard as colorblind viewers see it. Datawrapper's Viz Palette tool also tests palettes for colorblindness compatibility.

---

## Text on Color: Contrast

If you label marks directly or place text annotations over colored backgrounds, contrast matters for readability.

**WCAG AA minimum**: 4.5:1 contrast ratio for normal text, 3:1 for large text.

Common failures:
- White text on yellow or light green backgrounds
- Red text on blue backgrounds (the colors don't contrast even though they feel different)
- Dark text on dark map choropleth fills

**Check with**: Color Review (color.review) — enter foreground and background hex values, get a pass/fail for each text size.

---

## Palette Recommendations for Tableau

### Sequential (single hue)
- **Blues** (ColorBrewer) — safe, neutral, works on projectors
- **Greens** (ColorBrewer) — good for positive-direction data
- **Oranges/Reds** — use for heat or urgency, avoid for neutral data

### Sequential (multi-hue)
- **YlOrRd** (ColorBrewer) — yellow → orange → red; works well for density maps
- **BuGn** (ColorBrewer) — blue → green; good for environmental data

### Diverging
- **RdBu** (ColorBrewer) — red → white → blue; the standard for financial/political data
- **RdYlGn** (ColorBrewer) — red → yellow → green; familiar for KPI status, but has colorblindness issues — test before using

### Categorical
- **Tableau 10** — fine for general use, not colorblind-safe
- **ColorBrewer qualitative palettes** (Set1, Set2, Paired) — better colorblind safety
- **Custom brand palette** — extract hex values from the customer's brand guide; use for customer-facing dashboards

### Limit category colors to 5-7
Beyond 7 distinct hues, colors become indistinguishable and the legend becomes the chart. If you have more than 7 categories:
- Group low-volume categories into "Other" and color them grey
- Use a different encoding (small multiples, position, shape) instead of color

---

## Applying Custom Colors in Tableau

**Edit a color palette:**
1. Drag a field to Color on the marks card
2. Click Color → Edit Colors
3. Click a color swatch to change an individual member's color
4. Or select a built-in palette from the dropdown

**Create a custom palette (persistent across workbooks):**
1. Close Tableau Desktop
2. Open `My Tableau Repository/Preferences.tps` in a text editor
3. Add a `<color-palette>` block with named hex values
4. Reopen Tableau — the palette appears in Edit Colors

**Set a continuous color range:**
- Edit Colors → set Start and End colors
- Check "Use Full Color Range" only if you want the palette to span the actual data min/max (not recommended for maps where an outlier skews the palette)
- Use "Set Start and End" to pin the midpoint for diverging palettes

---

## Best Practices

1. **Choose the palette type based on data type, not aesthetics.** Continuous data gets a gradient. Categorical data gets distinct hues. Mixing these up is the most common color mistake.
2. **Grey first, color second.** Default marks to grey and apply color selectively to what matters. One colored element in a sea of grey carries more weight than ten colored elements competing.
3. **Limit categorical colors to 5-7.** Beyond that, use grouping, filtering, or small multiples.
4. **Start with ColorBrewer.** It is accessible, colorblind-tested, and print-safe. Use it as the default and deviate with purpose.
5. **Test every dashboard for colorblindness.** Run it through a simulator before delivery. Red-green combinations fail for ~8% of your male audience.
6. **Check text contrast when labeling over color.** Dark fills need white labels; light fills need dark labels. Never assume.
7. **Match the diverging midpoint to the data's meaningful center.** For profit/loss, the midpoint is zero — not the average of the data range.
8. **Integrate brand colors deliberately.** Use brand colors for the primary highlight, neutral greys for supporting marks. Do not force all brand colors into every chart.
9. **Place legends adjacent to their charts.** A legend at the top of a dashboard that serves a chart at the bottom forces constant eye-travel. Direct labels are better than distant legends.
10. **Color the category noun in annotations, not the whole sentence.** Only the word that names the category gets the category color. Coloring the full sentence implies the color means the observation, not the category.

---

## Common Mistakes

### 1. Using a gradient for categorical data
- **Problem**: Applying a sequential (light-to-dark) palette to product categories or regions.
- **Why it is wrong**: Gradients imply order and magnitude. Viewers will assume the darker color means "more" or "higher ranked."
- **Fix**: Use a qualitative palette with visually distinct hues.

### 2. Using distinct hues for continuous data
- **Problem**: Applying a rainbow or categorical palette to a measure like temperature or sales density.
- **Why it is wrong**: Distinct hues don't naturally communicate value differences. Viewers can't tell which hue is "higher."
- **Fix**: Use a sequential or diverging palette.

### 3. Red/green for positive/negative
- **Problem**: Green for profit, red for loss — the most common KPI color scheme.
- **Why it is wrong**: Red-green colorblindness affects roughly 8% of men. The signal is invisible to them.
- **Fix**: Use blue/orange, or add a secondary cue (up/down arrow, label, position) alongside the color.

### 4. Too many colors
- **Problem**: 10+ distinct colors in a bar chart legend.
- **Why it is wrong**: Viewers cannot reliably match legend swatches to marks when there are more than ~7. The legend becomes the chart.
- **Fix**: Group small categories into "Other." Highlight one or two categories in color, grey the rest.

### 5. Subtle gradient steps
- **Problem**: A beautiful 9-step sequential palette where steps 4 and 5 look identical at normal viewing distance.
- **Why it is wrong**: If viewers cannot perceive the difference between color steps, the encoding fails.
- **Fix**: Use 5-7 steps maximum for sequential palettes. Use the Chroma.js Color Palette Helper or ColorBrewer to verify perceptual spacing.

### 6. Defaulting to Tableau's rainbow palette
- **Problem**: Using the default rainbow diverging palette for all continuous data.
- **Why it is wrong**: Rainbow palettes create false boundaries where color changes rapidly. They also fail colorblindness tests.
- **Fix**: Use a single-hue sequential or two-hue diverging palette from ColorBrewer instead.

### 8. Legend too far from the data
- **Problem**: A shared color legend at the top of a multi-chart dashboard, with charts spread across the page.
- **Why it is wrong**: Readers need to check the legend repeatedly while reading a new chart. Long eye-travel between legend and mark slows comprehension and causes readers to give up.
- **Fix**: Use direct labels on marks where possible. When a legend is needed, position it immediately adjacent to the chart it serves.

### 7. Forcing brand colors onto data
- **Problem**: Applying a brand's three primary colors as the sequential palette for a choropleth map.
- **Why it is wrong**: Brand colors are not designed for perceptual uniformity. The steps may not be visually equal.
- **Fix**: Use brand colors for highlights and categorical labels where they work naturally. Use ColorBrewer for continuous data even in branded dashboards.

---

## Reinforcing Color Associations

Choosing a good palette is only half the job. Readers forget color-to-category mappings quickly — especially on dashboards with multiple charts. These techniques help keep the associations alive throughout the reading experience.

### Keep the Legend Close to the Data

Readers need to check the legend repeatedly, not just once. If the legend is at the top and the chart is at the bottom of a tall dashboard, readers are constantly eye-traveling between mark and key.

**Prefer direct labels over legends when possible.** Direct labels on marks (or at the end of lines) eliminate the round-trip entirely — the category name is right next to its color. In Tableau, add a dimension to Label on the marks card and set label placement to "End of line" for line charts, or enable "Allow labels to overlap" for dense views.

**When a legend is necessary**, place it immediately adjacent to the chart it serves — not in a shared header at the top of the dashboard. On a multi-chart dashboard, each chart with color encoding should have its legend nearby, or use consistent colors so one legend covers multiple charts.

### Use Colored Annotations

Annotations already sit close to the data they describe, which makes them more powerful than a distant legend. When you add a text annotation to a chart, color the category noun in the annotation to match its mark color — not the entire sentence.

**The rule**: color only the category name, not the observation about it.
- Correct: "*Nuclear* energy decreased its share since 2018" (where "Nuclear" is orange)
- Wrong: the entire sentence in orange — orange now means the decrease, not the category

**Text color vs. mark color**: Bright colors that read well as large filled marks often become illegible as thin text. Make the annotation text color one shade darker than the corresponding mark color. A mark at `#4BACC6` might need `#2E7D8C` for readable annotated text.

**In Tableau**: Double-click the canvas on a dashboard to add a floating text object, or use a text worksheet. Format text color per character using the rich text editor (select text → Format → Color).

### Use the Chart Title as the Legend

If a chart has 2-4 categories, the title can serve as the legend by naming each category in its color. This eliminates the separate legend entirely and makes the title do double duty.

Example title: "**Revenue** continued to grow while **Profit** declined in Q3" — where "Revenue" is blue and "Profit" is orange, matching the line colors.

**When it works**: 2-4 categories, short category names, a title that makes a statement rather than just labeling the chart.

**When to keep the legend anyway**: If viewers might start reading mid-dashboard (jumping to a specific chart), a traditional legend is safer — they won't have seen the title.

**In Tableau**: Double-click the chart title → use the rich text editor to select individual words and apply color formatting. Match the hex values to your mark colors exactly.

### Reinforce Colors in Tooltips

Tooltips appear right on the data point — the closest possible location to the mark. Including the category color in a tooltip reinforces the association at the moment of interaction, before the reader has traveled back to the legend.

**In Tableau custom tooltips**: use `<b>` tags with inline color styling to match the category color, or simply include the category name field prominently so readers see "Region: West" rather than just a number. The category field itself is the reminder.

For dashboards with highlight actions, Tableau's default tooltip already shows the highlighted category — lean into this rather than suppressing tooltips.

---

## Useful Tools

| Tool | Use |
|---|---|
| ColorBrewer 2.0 (colorbrewer2.org) | Pre-built sequential, diverging, and qualitative palettes; colorblind-safe options |
| Viz Palette (projects.susielu.com/viz-palette) | Test a palette against colorblindness and check if colors name uniquely |
| Chroma.js Color Palette Helper (vis4.net/palettes) | Build custom sequential palettes with perceptually uniform steps |
| Color Review (color.review) | Check text/background contrast ratios for WCAG compliance |
| Coblis (color-blindness.com/coblis) | Simulate how your image looks under different types of colorblindness |
| Adobe Color (color.adobe.com) | Generate harmonious palettes from a base color |

---

## Implementation

Use the sections above as the implementation reference for Tableau authoring. Apply the relevant pattern in the workbook or dashboard, then verify the result in Tableau for correctness, readability, and customer-safe behavior.

## Source and Confidence

- Source/evidence type: internal-doc
- Source: Datawrapper Blog — "Your Friendly Guide to Colors in Data Visualisation" (datawrapper.de/blog/colorguide) and "Remind readers of the colors in your data visualization" (datawrapper.de/blog/remind-readers-of-colors-in-data-vis) by Lisa Charlotte Muth; adapted for Tableau SE use by mbradbourne
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-05-26
