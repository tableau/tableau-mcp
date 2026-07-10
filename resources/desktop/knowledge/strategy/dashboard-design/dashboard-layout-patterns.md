# Dashboard Layout & Design Strategy

A guide for designing effective Tableau dashboard layouts — covering visual hierarchy, reading patterns, BANs, and filter placement. For sizing modes and container tree structure, see `dashboard-layout-structure.md`.

---

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: create, refine
- In-scope reason: Helps Claude design effective dashboard layouts with sound visual hierarchy when authoring.
- Out-of-scope risk: none
- Tags: dashboards, layout, visual-hierarchy, bans, design-strategy
- Relevant user prompts/search terms: "Z-pattern dashboard layout", "BAN row design", "filter sidebar or top bar", "executive vs analyst dashboard", "how many charts per dashboard", "primary focal point layout", "consistent spacing dashboard", "inverted pyramid layout", "KPI summary dashboard design", "presentation dashboard pattern"

## When to Use

Use this guide when:

- **Building a new dashboard** from scratch and need to decide on layout structure before adding sheets
- **Reorganizing an existing dashboard** that feels cluttered or lacks a clear narrative
- **Designing for a specific audience** (executive summary, analyst deep-dive, presentation/TV display)
- **Planning BAN/KPI summary dashboards** where headline numbers drive the story

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

**Best for**: Executive dashboards, KPI summaries, any dashboard where four distinct views tell a progressive story. Place the single most important insight at position 1.

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

**Best for**: Analytical dashboards where the audience first needs the summary, then wants to drill into supporting segments and detail.

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

1. **Primary (top-left quadrant)**: The single most important metric or chart. This is what the viewer should see within the first 2 seconds.

2. **Secondary (top-right and bottom-left)**: Supporting context that explains or breaks down the primary insight.

3. **Tertiary (bottom-right or below fold)**: Detail tables, granular filters, legends, footnotes.

### Hierarchy Rules

- **One focal point per dashboard.** If everything is equally prominent, nothing is prominent.
- **Size encodes importance.** The primary viz should occupy 30-50% of the dashboard area.
- **Whitespace is a signal.** Extra padding around the primary viz draws the eye toward it.
- **Filters and controls are not the story.** Place them in a sidebar or thin top bar.

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

1. **Font size**: 24-48pt for the number itself. The label/title should be 10-14pt.
2. **Minimal decoration**: No gridlines, no axes, no borders around the BAN sheet.
3. **Consistent width**: Each BAN in a row should occupy equal width. Use a horizontal layout container set to distribute evenly.
4. **Color for meaning**: Green/red for positive/negative delta. Use sparingly — if every BAN is colored, the signal is lost.
5. **Delta indicators**: Show change vs. prior period as a smaller secondary number or arrow beneath the main figure.
6. **Alignment**: Center-align both the number and the label within each BAN zone.

### BAN Zone Height

- **80-120px** is the sweet spot. Taller wastes space; shorter makes the number hard to read at a glance.
- The BAN row should consume no more than 10-15% of total dashboard height.

---

## Filter & Parameter Placement

### Placement Strategies

| Strategy | Layout | Best For |
|----------|--------|----------|
| **Right sidebar** | Vertical container, fixed width 200-280px, right edge | Dashboards with 3+ filters |
| **Top bar** | Horizontal container, fixed height 40-60px, below title | 1-2 compact filters |
| **Floating** | Overlay, toggled visible/hidden | Rarely used filters |
| **Left sidebar** | Vertical container, fixed width 200-280px, left edge | Navigation-style dashboards |

### Decision Framework

- **1-2 filters**: Top bar.
- **3-5 filters**: Right sidebar.
- **6+ filters**: Right sidebar with collapsible sections, or a dedicated filter dashboard page.
- **Rarely used filters**: Floating with a Show/Hide button object on the dashboard.

### Filter Zone Sizing

- **Dropdown (single-select)**: Height 40-60px, width 180-250px
- **Multi-select list**: Height 120-200px, width 180-250px
- **Slider (range)**: Height 50-70px, width 200-300px
- **Parameter control**: Height 40-60px, width 150-220px

---

## Best Practices

1. **Lead with insight, not data.** The top-left zone should answer the dashboard's primary question.
2. **Limit to 4-6 visualizations per dashboard.** More charts compete for attention and shrink to illegible sizes.
3. **Use BANs for KPIs.** A 36-48pt number communicates status faster than any chart.
4. **Put filters in a consistent location** — right sidebar or top bar — and keep them out of the primary content area.
5. **Use tiled layout by default.** Floating elements cause overlapping and alignment issues.
6. **Design for the smallest target screen.** A 1920x1080 dashboard viewed on a 1366x768 laptop will be unreadable.
7. **Group related charts visually** using background color containers or subtle borders.
8. **Maintain consistent spacing** (8-16px padding) between all dashboard elements.
9. **Choose a layout pattern** (Z, F, or inverted pyramid) and commit to it.
10. **Test on the target device.** Preview at actual resolution, not just in Desktop's authoring view.

---

## Common Mistakes

### 1. Too Many Charts

**Problem**: Cramming 7+ visualizations onto a single dashboard.

**Fix**: Limit to 4-6 per dashboard. Split across multiple dashboards connected by navigation actions or a story.

### 2. No Clear Focal Point

**Problem**: All charts are the same size in a uniform grid.

**Fix**: Make the primary viz 1.5-2x the area of secondary views. Use the Z-pattern or inverted pyramid.

### 3. Inconsistent Spacing

**Problem**: Some zones have 2px gaps, others have 20px.

**Fix**: Use consistent padding — inner 8px, outer 12-16px, BAN row separation 4-8px. Set via the Layout pane.

### 4. Filters Dominating the Layout

**Problem**: A row of 6 filters consuming 150px of vertical space before any data appears.

**Fix**: Move to a right sidebar or use floating filters with a toggle.

### 5. Floating Elements Overlapping Tiled Content

**Problem**: Floating zones overlap tiled layout on resize.

**Fix**: Reserve floating objects for intentional overlays (annotations, show/hide panels). All structural layout should use tiled containers.

### 6. No Visual Grouping

**Problem**: All charts sit on the same flat background with no separation between logical groups.

**Fix**: Use container background colors — light gray dashboard background (`#F5F5F5`) with white containers (`#FFFFFF`) for each logical group.

### 7. Ignoring Mobile / Varied Screen Sizes

**Problem**: Designing at 1920x1080, then wondering why it looks terrible on a 1366x768 laptop.

**Fix**: Design for the smallest common screen in your audience.

### 8. Wrong Sizing Mode Squishing Content

**Problem**: Fixed sizing with multiple charts forces all content to fit, making charts unreadably small.

**Fix**: Use Vertical Scroll mode for dashboards with 4+ visualizations. See `dashboard-layout-structure.md` for sizing mode guidance.

---

## Implementation

Use the sections above as the implementation reference for Tableau authoring. Apply the relevant pattern in the workbook or dashboard, then verify the result in Tableau for correctness, readability, and customer-safe behavior.

## Source and Confidence

- Source/evidence type: internal-doc
- Source: imported from prior Tableau authoring knowledge base (mbradbourne)
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-05-22
