# Dashboard: Layout & Design Strategy

A guide for designing effective Tableau dashboard layouts — covering visual hierarchy, spacing, sizing, and implementation via the workbook JSON zone tree.

---

## Scope Check


- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: create, refine
- In-scope reason: This helps Claude design effective dashboard layouts by choosing visual hierarchy patterns and sizing modes that match the user's target audience and deployment context.
- Out-of-scope risk: none
- Tags: dashboards, layout, visual-hierarchy, spacing, sizing, zone-tree, bans, filter-sidebar, z-pattern, f-pattern, inverted-pyramid, fixed-size, automatic-size, vscroll, coordinate-calculation, container, distribute-evenly
- Relevant user prompts/search terms: "dashboard zone tree structure", "BAN row layout container", "fixed vs automatic vs vscroll sizing", "calculate zone coordinates", "distribute evenly container", "filter sidebar fixed width", "spacing with empty zones", "background color visual grouping", "1366x768 dashboard dimensions", "vertical scroll mode for multi-chart"

## When to Use This Module

Use this module when:

- **Building a new dashboard** from scratch and need to decide on layout structure before adding sheets
- **Reorganizing an existing dashboard** that feels cluttered or lacks a clear narrative
- **Designing for a specific audience** (executive summary, analyst deep-dive, presentation/TV display)
- **Planning BAN/KPI summary dashboards** where headline numbers drive the story
- **Choosing between fixed, automatic, or range sizing** for a target deployment context

This module focuses on *design decisions*. For the mechanics of constructing dashboards in workbook JSON, see `data/prefabs/dashboard-composition.md`.

---

## Layout Principles

### Z-Pattern (Western Reading Order)

The eye naturally moves: **top-left > top-right > bottom-left > bottom-right**.

```
 ┌──────────────┬──────────────┐
 │  1. KPI / BAN │  2. Trend    │
 ├──────────────┼──────────────┤
 │  3. Breakdown │  4. Detail   │
 └──────────────┴──────────────┘
```

**Best for**: Executive dashboards, KPI summaries, any dashboard where four distinct views tell a progressive story. Place the single most important insight at position 1. Supporting context flows naturally through positions 2-4.

### F-Pattern (Scanning)

The eye scans horizontally across the top, then drops down the left edge with decreasing horizontal reach.

```
 ┌─────────────────────────────┐
 │  Headline / BAN row          │  ← full-width scan
 ├──────────────┬──────────────┤
 │  Primary viz  │  Secondary   │  ← shorter scan
 ├──────────────┤              │
 │  Detail/table │              │  ← left-biased
 └──────────────┴──────────────┘
```

**Best for**: Dashboards with a dominant left-column visualization and supporting right-column context. Works well when the primary chart is a tall time-series or bar chart.

### Inverted Pyramid

Key insight at the top in a full-width zone, progressively more granular data below.

```
 ┌─────────────────────────────┐
 │  Key Insight (full width)    │
 ├──────────┬──────────────────┤
 │  Segment  │   Segment        │
 ├────┬─────┼────┬─────────────┤
 │ D1 │ D2  │ D3 │  D4          │
 └────┴─────┴────┴─────────────┘
```

**Best for**: Analytical dashboards where the audience first needs the summary, then wants to drill into supporting segments and detail. Common in financial reporting and operational dashboards.

### Choosing a Pattern

| Audience | Recommended Pattern | Reason |
|----------|-------------------|--------|
| Executives | Z-pattern or Inverted Pyramid | Quick scan, key number first |
| Analysts | F-pattern | Deep-dive left column with reference on right |
| Presentations / TV | Z-pattern (2x2 grid) | Readable at distance, balanced |
| Embedded / portal | Inverted Pyramid | Works in variable-width containers |

---

## Information Hierarchy

### The Three Tiers

1. **Primary (top-left quadrant)**: The single most important metric or chart. This is what the viewer should see within the first 2 seconds. Examples: revenue trend, conversion rate, headline KPI.

2. **Secondary (top-right and bottom-left)**: Supporting context that explains or breaks down the primary insight. Examples: breakdown by region, comparison to prior period, category distribution.

3. **Tertiary (bottom-right or below fold)**: Detail tables, granular filters, legends, footnotes. The viewer reaches this only after absorbing the primary and secondary content.

### Hierarchy Rules

- **One focal point per dashboard.** If everything is equally prominent, nothing is prominent.
- **Size encodes importance.** The primary viz should occupy 30-50% of the dashboard area. Secondary views each get 15-25%. Tertiary elements fill the remainder.
- **Whitespace is a signal.** Extra padding around the primary viz draws the eye toward it.
- **Filters and controls are not the story.** They should never compete with the primary viz for attention. Place them in a sidebar or thin top bar.

### Visual Weight Techniques

| Technique | Effect |
|-----------|--------|
| Larger zone dimensions | Draws attention first |
| Darker or saturated background behind a zone | Creates visual pop |
| White container on gray dashboard background | Lifts the element forward |
| Title with bold/larger font | Anchors the eye |
| Border or shadow on a container | Separates and emphasizes |

---

## BANs (Big Ass Numbers)

BANs are large-format single numbers displayed prominently — typically KPIs like revenue, count, or percentage change.

### When to Use BANs

- **KPI summary row at the top** of a dashboard (the most common pattern)
- **Scorecard dashboards** where 4-8 metrics are the entire story
- **Call-to-action dashboards** where a threshold number drives decisions (e.g., "Orders Pending: 47")

### BAN Design Rules

1. **Font size**: 24-48pt for the number itself. The label/title should be 10-14pt — small enough to not compete.
2. **Minimal decoration**: No gridlines, no axes, no borders around the BAN sheet. Strip everything away so only the number and label remain.
3. **Consistent width**: Each BAN in a row should occupy equal width. Use a horizontal `layout-basic` container with `distribute-evenly` strategy.
4. **Color for meaning**: Green/red for positive/negative delta. Use sparingly — if every BAN is colored, the signal is lost.
5. **Delta indicators**: Show change vs. prior period as a smaller secondary number or arrow beneath the main figure.
6. **Alignment**: Center-align both the number and the label within each BAN zone.

### BAN Row Layout (Zone Tree Pattern)

A typical BAN row is a horizontal container holding 3-5 equal-width zones:

```
Root (layout-basic, flow)
├── Title zone (full width, h=40)
├── BAN container (layout-basic, distribute-evenly, h=100)
│   ├── BAN 1 (visual, "Revenue KPI")
│   ├── BAN 2 (visual, "Orders KPI")
│   ├── BAN 3 (visual, "Margin KPI")
│   └── BAN 4 (visual, "Customers KPI")
├── Primary viz zone (visual, h=remaining)
└── ...
```

Each BAN worksheet should contain a single `AGG()` measure on Text, with the sheet title hidden (`show-title: false`) and a formatted-text zone or sheet title used as the label.

### BAN Zone Height

- **80-120px** is the sweet spot. Taller than 120px wastes space; shorter than 80px makes the number too small to read at a glance.
- The BAN row should consume no more than 10-15% of total dashboard height.

---

## Filter & Parameter Placement

### Placement Strategies

| Strategy | Layout | Best For |
|----------|--------|----------|
| **Right sidebar** | Vertical container, fixed width 200-280px, right edge | Dashboards with 3+ filters; keeps filters visible without crowding the viz area |
| **Top bar** | Horizontal container, fixed height 40-60px, below title | 1-2 compact filters (dropdowns); minimal vertical space impact |
| **Floating** | Overlay on dashboard, toggled visible/hidden | Mobile layouts, minimal-chrome dashboards, power-user filters used rarely |
| **Left sidebar** | Vertical container, fixed width 200-280px, left edge | Navigation-style dashboards where filters act as the primary interaction model |

### Decision Framework

- **1-2 filters**: Top bar. Minimal footprint, always visible.
- **3-5 filters**: Right sidebar. Organized vertically, out of the primary viewing path.
- **6+ filters**: Right sidebar with collapsible sections, or a dedicated filter dashboard page in a story/navigation setup.
- **Rarely used filters**: Floating with a show/hide button (use `set_zone_visibility`).

### Filter Zone Sizing

- **Dropdown (single-select)**: Height 40-60px, width 180-250px
- **Multi-select list**: Height 120-200px, width 180-250px
- **Slider (range)**: Height 50-70px, width 200-300px
- **Parameter control**: Height 40-60px, width 150-220px

### Sidebar Implementation

Use a nested container approach in the zone tree:

```
Root (layout-basic, flow, horizontal)
├── Content area (layout-basic, flow, vertical, flexible width)
│   ├── Title
│   ├── BAN row
│   └── Viz zones
└── Filter sidebar (layout-basic, flow, vertical, is-fixed=true, fixed-size=250)
    ├── Filter 1 (filter zone)
    ├── Filter 2 (filter zone)
    └── Parameter 1 (paramctrl zone)
```

The `is-fixed: true` and `fixed-size: 250` on the sidebar zone ensures it holds its width while the content area absorbs remaining space.

---

## Sizing Strategy

### Sizing Modes

| Mode | `sizing-mode` | When to Use |
|------|--------------|-------------|
| **Fixed** | `fixed` | Known target screen size; presentations, kiosks, PDF export |
| **Automatic** | `automatic` | Embedded in web apps with variable container size |
| **Range** | `range` | Responsive layouts with min/max bounds |
| **Vertical Scroll** | `vscroll` | **Default for multi-chart dashboards** - Allows vertical scrolling instead of squishing content. Use when you have 4+ visualizations or when content height exceeds viewport. Prevents charts from becoming unreadably small. |

### Common Target Sizes

| Context | Width x Height | Notes |
|---------|---------------|-------|
| Laptop (standard) | 1366 x 768 | Most common corporate laptop resolution |
| Laptop (hi-res) | 1440 x 900 | MacBook, modern Windows laptops |
| Desktop / presentation | 1920 x 1080 | Full HD monitors, projectors |
| Tablet (landscape) | 1024 x 768 | iPad classic |
| TV / wall display | 1920 x 1080 | Same as desktop; use large fonts |
| Embedded (narrow) | 800 x 600 | Portal widgets, sidebar embeds |

### Sizing Rules

1. **Default to `vscroll` for dashboards with multiple charts** to prevent squishing. Fixed sizing forces all content to fit, making charts unreadably small when you have 4+ visualizations.
2. **Use `fixed` only when** you have a known target screen size and minimal content (1-3 charts) that fits comfortably without scrolling.
3. **Design for the smallest target screen**, not the largest. A dashboard designed at 1920x1080 will be unreadable on a 1366x768 laptop.
4. **Subtract browser chrome** from the target resolution. At 1366x768, the usable Tableau Server viewport is roughly 1350x650 after the toolbar and browser address bar.
5. **Range mode** is useful when publishing to both Tableau Server (viewed in browsers of varying width) and Tableau Mobile. Set `minwidth`/`minheight` for the smallest target and `maxwidth`/`maxheight` for the largest.

### Size Node in Workbook JSON

```json
{
  "type": "size",
  "attrs": {
    "sizing-mode": "fixed",
    "maxwidth": "1366",
    "maxheight": "768"
  }
}
```

For range mode, include all four bounds:

```json
{
  "type": "size",
  "attrs": {
    "sizing-mode": "range",
    "minwidth": "800",
    "minheight": "600",
    "maxwidth": "1400",
    "maxheight": "900"
  }
}
```

For vertical scroll mode (recommended for multi-chart dashboards):

```xml
<size maxwidth="1400" minwidth="800" sizing-mode="vscroll"/>
```

**Key points for `vscroll`:**
- Only set `maxwidth` and `minwidth` (not height) - height is determined by content
- Content flows vertically and scrolls when it exceeds the viewport
- Prevents squishing - each chart maintains its natural size
- Use when you have 4+ visualizations or when content naturally exceeds viewport height

---

## Best Practices Summary

1. **Lead with insight, not data.** The top-left zone should answer the dashboard's primary question — not show a giant table.
2. **Limit to 4-6 visualizations per dashboard.** More charts compete for attention and shrink to illegible sizes.
3. **Use BANs for KPIs.** A 36-48pt number with a label communicates status faster than any chart.
4. **Put filters in a consistent location** — right sidebar or top bar — and keep them out of the primary content area.
5. **Use tiled layout by default.** Floating elements cause overlapping and alignment issues. Only float for annotations, logos, or BAN overlays.
6. **Design for the smallest target screen.** A 1920x1080 dashboard viewed on a 1366x768 laptop will be unreadable.
7. **Group related charts visually** using background color containers or subtle borders — not lines or whitespace alone.
8. **Maintain consistent spacing** (8-16px padding) between all dashboard elements. Use empty zones as spacers.
9. **Choose a layout pattern** (Z, F, or inverted pyramid) and commit to it. Mixing patterns confuses the viewer's scan path.
10. **Test on the target device.** Preview at actual resolution, not just in Desktop's authoring view.

## Common Mistakes

### 1. Too Many Charts

**Problem**: Cramming 7+ visualizations onto a single dashboard. Each chart becomes too small to read, and the viewer has no idea where to look first.

**Fix**: Limit to 4-6 visualizations per dashboard. If you need more views, split across multiple dashboards connected by navigation actions or a story.

### 2. No Clear Focal Point

**Problem**: All charts are the same size in a uniform grid. Nothing says "look here first."

**Fix**: Make the primary viz 1.5-2x the area of secondary views. Use the Z-pattern or inverted pyramid to establish hierarchy.

### 3. Inconsistent Spacing

**Problem**: Some zones have 2px gaps, others have 20px. Borders on some elements but not others. The layout feels unpolished.

**Fix**: Use consistent padding throughout. Standard values:
- **Inner padding** (within a container): 8px
- **Outer padding** (between major sections): 12-16px
- **BAN row separation**: 4-8px between individual BANs

In the zone tree, control spacing via zone coordinates. For a 12px gap between two zones stacked vertically:
```
Zone A: y=0, h=300
Zone B: y=312, h=300   ← 300 + 12 = 312
```

### 4. Filters Dominating the Layout

**Problem**: A row of 6 filter controls across the top consuming 150px of vertical space — 20% of a 768px dashboard gone before any data appears.

**Fix**: Move to a right sidebar (fixed 250px width) or use floating filters with a toggle. Compact single-value dropdowns can stay in a thin (40px) top bar.

### 5. Wrong Sizing Mode / Squishing Content

**Problem**: Using fixed sizing with `minheight`/`maxheight` on dashboards with multiple charts, forcing all content to fit and making charts unreadably small (squishing).

**Fix**: Use `vscroll` mode for dashboards with 4+ visualizations. Set only `maxwidth`/`minwidth` (not height) - this allows vertical scrolling instead of squishing. Reserve fixed sizing for dashboards with 1-3 charts that fit comfortably in the viewport.

### 6. Ignoring Mobile / Varied Screen Sizes

**Problem**: Designing at 1920x1080, then wondering why it looks terrible on a 1366x768 laptop.

**Fix**: Design for the smallest common screen in your audience. If mixed sizes, use range mode with tested min/max bounds.

### 7. Floating Elements Overlapping Tiled Content

**Problem**: Using floating zones without accounting for the tiled layout underneath, creating overlaps on resize.

**Fix**: Reserve floating zones for elements that must overlay (tooltips, show/hide panels). All structural layout should be tiled using `layout-basic` containers with `flow` strategy.

### 8. No Visual Grouping

**Problem**: All charts sit on the same flat background with no visual separation between logical groups.

**Fix**: Use container background colors to group related elements. A light gray dashboard background (`#F5F5F5`) with white containers (`#FFFFFF`) for each logical group creates clear visual separation without heavy borders.

---

## Implementation in Tableau Desktop

### Zone Tree Architecture

Every dashboard is a tree of zones rooted in a single `layout-basic` zone. The tree structure determines both visual layout and resize behavior. See `data/prefabs/dashboard-composition.md` for the full zone type reference.

**Key zone types for layout:**

| Zone Type | Role in Layout |
|-----------|---------------|
| `layout-basic` | Container — holds child zones, controls flow direction |
| `layout-flow` | Flow container — wraps children automatically |
| `visual` | Worksheet embed — the `name` attr must match an existing sheet |
| `text` | Static text / labels — uses `formatted-text` child |
| `filter` | Quick filter control |
| `paramctrl` | Parameter control |
| `empty` | Spacer — use for precise gap control between zones |
| `title` | Dashboard title zone |

### Building a Z-Pattern Layout

The Z-pattern maps to a two-row, two-column grid:

```
Root (layout-basic, flow) — vertical stacking
├── Title (title, h=40)
├── Top row (layout-basic, distribute-evenly, h=350)
│   ├── Top-left viz (visual, "Primary Chart")
│   └── Top-right viz (visual, "Trend Chart")
└── Bottom row (layout-basic, distribute-evenly, h=350)
    ├── Bottom-left viz (visual, "Breakdown")
    └── Bottom-right viz (visual, "Detail Table")
```

### Building a BAN + Detail Layout

```
Root (layout-basic, flow) — vertical stacking
├── Title (title, h=36)
├── BAN row (layout-basic, distribute-evenly, h=90)
│   ├── BAN 1 (visual)
│   ├── BAN 2 (visual)
│   ├── BAN 3 (visual)
│   └── BAN 4 (visual)
├── Primary viz (visual, h=320)
└── Detail row (layout-basic, distribute-evenly, h=280)
    ├── Secondary viz A (visual)
    └── Secondary viz B (visual)
```

### Building a Sidebar Filter Layout

The key is nesting a horizontal container at the root, with the content area flexible and the sidebar fixed:

```
Root (layout-basic, flow) — horizontal direction
├── Content (layout-basic, flow) — vertical, takes remaining width
│   ├── Title (title, h=36)
│   ├── BAN row (layout-basic, distribute-evenly, h=90)
│   │   └── ...BANs...
│   └── Main viz (visual, fills remaining height)
└── Sidebar (layout-basic, flow, is-fixed=true, fixed-size=250) — vertical
    ├── Filter: Region (filter, h=60)
    ├── Filter: Category (filter, h=60)
    ├── Filter: Date Range (filter, h=70)
    └── Spacer (empty, fills remaining)
```

### Spacing with Empty Zones

Use `empty` zones as spacers when you need precise gaps between elements:

```json
{
  "type": "zone",
  "attrs": {
    "id": 20,
    "x": 0, "y": 300, "w": 1200, "h": 12,
    "type-v2": "empty",
    "is-fixed": true,
    "fixed-size": 12
  }
}
```

The `is-fixed: true` with `fixed-size: 12` ensures the spacer remains exactly 12px regardless of dashboard resize behavior.

### Background Color for Visual Grouping

To set a container's background color, add a `format` child to the zone:

```json
{
  "type": "zone",
  "attrs": { "id": 10, "type-v2": "layout-basic", ... },
  "children": [
    {
      "type": "format",
      "attrs": {
        "attr": "fill",
        "value": "#FFFFFF"
      }
    },
    { "type": "zone", ... },
    { "type": "zone", ... }
  ]
}
```

Use `#F5F5F5` or `#EEEEEE` for the root dashboard background and `#FFFFFF` for content group containers to create depth.

### Coordinate Calculation

Zone coordinates (`x`, `y`, `w`, `h`) are **relative to the parent container**. When planning a layout:

1. Start with the root zone at `(0, 0, totalWidth, totalHeight)`.
2. Allocate height to each row: title (36-40px), BAN row (80-100px), remaining to content.
3. For horizontal splits, divide the parent's width among children.
4. Account for gaps by subtracting spacing from available dimensions.

**Example** — 1366x768 dashboard with title, BAN row, and 2x2 content grid with 8px gaps:

```
Root:        x=0,   y=0,   w=1366, h=768
Title:       x=0,   y=0,   w=1366, h=36
BAN row:     x=0,   y=44,  w=1366, h=90    ← 36 + 8 gap
Content top: x=0,   y=142, w=1366, h=305   ← 44 + 90 + 8 gap
  Left:      x=0,   y=0,   w=679,  h=305   ← (1366-8)/2
  Right:     x=687, y=0,   w=679,  h=305   ← 679 + 8 gap
Content bot: x=0,   y=455, w=1366, h=305   ← 142 + 305 + 8 gap
  Left:      x=0,   y=0,   w=679,  h=305
  Right:     x=687, y=0,   w=679,  h=305
```

Remaining height check: 455 + 305 = 760, leaving 8px bottom padding. Total = 768.

---

## Examples

### Example 1: Executive KPI Dashboard (Z-Pattern, 1366x768)

**Audience**: Senior leadership reviewing weekly metrics
**Layout**: Z-pattern with BAN row

```
┌──────────────────────────────────────┐
│  Dashboard Title                      │  36px
├────────┬────────┬────────┬───────────┤
│ Rev $2.4M│ Orders 1.2K│ Margin 34%│ NPS 72 │  90px — BAN row
├──────────────────┬───────────────────┤
│ Revenue Trend     │ Revenue by Region │  310px — primary row
│ (line chart)      │ (filled map)      │
├──────────────────┼───────────────────┤
│ Top Products      │ Monthly Detail    │  310px — secondary row
│ (bar chart)       │ (crosstab)        │
└──────────────────┴───────────────────┘
```

**Design decisions**:
- Fixed sizing at 1366x768 (target: corporate laptops)
- 4 BANs in `distribute-evenly` container
- Revenue Trend at top-left as the focal point (Z-pattern position 1)
- No sidebar filters — this is a read-only summary with date controlled by a parameter in the BAN row

### Example 2: Operational Analyst Dashboard (F-Pattern, 1366x768)

**Audience**: Operations analysts monitoring daily performance
**Layout**: F-pattern with right sidebar filters

```
┌──────────────────────────────┬──────┐
│  Dashboard Title              │      │
├──────────────────────────────┤  F   │
│  Daily Volume Trend           │  i   │  — tall primary viz, 450px
│  (area chart, full width)     │  l   │
│                               │  t   │
├──────────┬───────────────────┤  e   │
│ By Status │ By Category       │  r   │  — secondary row, 280px
│ (donut)   │ (bar)             │  s   │
└──────────┴───────────────────┴──────┘
                                 250px
```

**Design decisions**:
- Sidebar at 250px fixed width holds 4 dropdown filters (Region, Status, Date Range, Category)
- Primary viz is tall (60% of content height) per the F-pattern — the eye lingers on the left/center
- Secondary views are smaller and below the fold — analyst scrolls down or glances after absorbing the trend
- `empty` spacer zones (8px) between the primary and secondary rows

### Example 3: Presentation Dashboard (Z-Pattern, 1920x1080)

**Audience**: Board presentation on a projector
**Layout**: Z-pattern, large fonts, high contrast

```
┌───────────────────────────────────────────────┐
│           Quarterly Business Review             │  50px — large title
├─────────────┬─────────────┬──────────┬────────┤
│  Revenue     │  Profit      │  Growth   │ Churn  │  120px — oversized BANs
│  $14.2M      │  $3.1M       │  +18%     │ 2.4%   │
├──────────────────────────┬────────────────────┤
│  Revenue by Quarter       │  Profit by Segment  │  430px
│  (bar chart, large axis)  │  (stacked bar)      │
├──────────────────────────┴────────────────────┤
│  Regional Performance (horizontal bar, ranked) │  430px
└───────────────────────────────────────────────┘
```

**Design decisions**:
- Fixed at 1920x1080 for full-HD projector
- BAN row is 120px (taller than normal) for readability at distance
- Only 3 charts + 4 BANs — simplicity is critical for presentations
- No filters — this is a static snapshot for a specific time period
- Large axis labels and chart titles (14pt+)
- High-contrast color palette: dark blue on white

### Example 4: Compact Embedded Widget (Inverted Pyramid, 800x600)

**Audience**: Portal users viewing a summary widget
**Layout**: Inverted pyramid, automatic sizing

```
┌─────────────────────────────┐
│  Overall Score: 87 / 100     │  80px — single BAN
├──────────────────────────────┤
│  Score Trend (sparkline)     │  200px — context
├──────────┬───────────────────┤
│ By Team   │ By Category       │  300px — detail
└──────────┴───────────────────┘
```

**Design decisions**:
- Range sizing: min 600x400, max 1000x700 — adapts to portal container
- Single BAN as the headline (inverted pyramid — key insight first)
- Sparkline provides trend context without axis clutter
- Two small breakdowns at the bottom for users who want detail
- No title zone — the portal provides its own header
- No filters — controlled externally via URL parameters or portal context

---

## Technical Workflow: Applying Dashboards

### ⚠️ CRITICAL: Workbook vs Dashboard Application Order

When applying dashboard changes that require viewpoints, you must follow the correct workflow to avoid overwriting your changes.

**The Problem:**
- `apply-workbook` replaces the **ENTIRE** workbook state in Tableau
- If you apply a dashboard, then apply a stale workbook XML, the dashboard changes will be **OVERWRITTEN**
- This happens because the workbook XML doesn't include the dashboard changes you just made

**The Solution:**

#### Option 1: Use `apply-dashboard-with-viewpoints` (Recommended)
This tool handles both dashboard and viewpoints safely:
1. Gets a **fresh** workbook from Tableau (includes your dashboard changes)
2. Adds viewpoints to the dashboard window
3. Applies workbook with viewpoints
4. Applies dashboard XML

```typescript
// ✅ CORRECT - Safe workflow
apply-dashboard-with-viewpoints({
  dashboard_name: "My Dashboard",
  dashboard_file: "path/to/dashboard.xml",
  worksheet_names: ["Sheet 1", "Sheet 2"]
})
```

#### Option 2: Manual Workflow (If you must)
If you need to manually edit the workbook XML:

1. **Apply dashboard first:**
   ```typescript
   apply-dashboard({
     dashboard_name: "My Dashboard",
     dashboard_file: "path/to/dashboard.xml"
   })
   ```

2. **Get FRESH workbook (includes dashboard changes):**
   ```typescript
   const { workbook_file } = get-workbook-xml()
   ```

3. **Edit workbook to add viewpoints:**
   - Modify the dashboard window's `<viewpoints>` element
   - Add `<viewpoint>` entries for each worksheet

4. **Apply workbook:**
   ```typescript
   apply-workbook({ workbook_file })
   ```

#### ❌ WRONG - This Will Overwrite Dashboard:
```typescript
// ❌ WRONG - Stale workbook overwrites dashboard
apply-dashboard({ dashboard_name, dashboard_file })
apply-workbook({ workbook_file: "old/stale/workbook.xml" }) // Overwrites dashboard!
```

### Key Rules:

1. **Never apply a workbook XML that was fetched before applying a dashboard** - it will overwrite your dashboard changes
2. **Always get a fresh workbook after applying a dashboard** if you need to modify viewpoints
3. **Prefer `apply-dashboard-with-viewpoints`** - it handles this automatically
4. **When in doubt, get a fresh workbook** with `get-workbook-xml()` before applying

### Viewpoints Requirement

Every worksheet referenced in a dashboard's zones **MUST** have a corresponding viewpoint in the dashboard's window element:

```xml
<window class="dashboard" name="My Dashboard">
  <viewpoints>
    <viewpoint name="Sheet 1">
      <zoom type="entire-view"/>
    </viewpoint>
    <viewpoint name="Sheet 2">
      <zoom type="entire-view"/>
    </viewpoint>
  </viewpoints>
</window>
```

Without viewpoints, Tableau will reject the dashboard with an internal error.

## Source and Confidence

- Source/evidence type: design best-practice
- Source: Visual-hierarchy and dashboard-layout best practice (Z/F-pattern, inverted pyramid) from general BI design literature applied to Tableau
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-02
