# Dashboard Sizing, Containers & Layout Examples

Implementation reference for Tableau dashboard structure — covering sizing modes, container trees, and worked examples for common layouts. For design strategy (patterns, hierarchy, BANs, filters), see `dashboard-layout-patterns.md`.

---

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: create, format
- In-scope reason: Helps Claude choose sizing modes and container structures when authoring dashboard layouts.
- Out-of-scope risk: none
- Tags: dashboards, sizing, containers, layout, structure
- Relevant user prompts/search terms: "dashboard sizing mode recommendations", "fixed vs automatic sizing", "how to structure dashboard containers", "BAN row layout", "sidebar filter placement", "Z-pattern dashboard design", "dashboard too squished", "container tree for executive KPI", "vertical scroll vs fixed height", "1366x768 dashboard layout"

## When to Use

Use this guide when:

- **Choosing a sizing mode** (fixed, automatic, range, vertical scroll) for a specific deployment context
- **Planning a container tree** before building a dashboard
- **Explaining why content is squishing** or overflowing
- **Building a specific layout type** — executive KPI, analyst with sidebar, or presentation

---

## Sizing Strategy

### Sizing Modes

| Mode | When to Use |
|------|-------------|
| **Fixed** | Known target screen size; presentations, kiosks, PDF export |
| **Automatic** | Embedded in web apps with variable container size |
| **Range** | Responsive layouts with min/max bounds |
| **Vertical Scroll** | **Default for multi-chart dashboards** — allows vertical scrolling instead of squishing content |

Set sizing mode via **Dashboard menu → Dashboard Size**.

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

1. **Default to Vertical Scroll for multi-chart dashboards** — prevents squishing when you have 4+ visualizations.
2. **Use Fixed only when** you have a known target screen size and minimal content (1-3 charts) that fits comfortably.
3. **Design for the smallest target screen**, not the largest.
4. **Subtract browser chrome** from the target resolution. At 1366x768, the usable Tableau Server viewport is roughly 1350x650 after the toolbar and browser address bar.
5. **Range mode** is useful when publishing to both Tableau Server and Tableau Mobile — set min and max width/height for the target range.

---

## Container Types

| Container | Role |
|-----------|------|
| Horizontal layout container | Arranges children side-by-side |
| Vertical layout container | Stacks children top to bottom |
| Blank | Spacer — use for precise gap control |
| Text object | Static labels, titles, callouts |
| Image | Logo, divider graphic |
| Filter / Parameter control | Interactive controls |

---

## Container Tree Patterns

### Z-Pattern Layout

```
Vertical container (root)
├── Title (text object, ~36px)
├── Horizontal container — top row (evenly distributed)
│   ├── Primary viz (sheet)
│   └── Trend viz (sheet)
└── Horizontal container — bottom row (evenly distributed)
    ├── Breakdown viz (sheet)
    └── Detail table (sheet)
```

### BAN + Detail Layout

```
Vertical container (root)
├── Title (text object, ~36px)
├── Horizontal container — BAN row (evenly distributed, ~90px)
│   ├── BAN 1 (sheet)
│   ├── BAN 2 (sheet)
│   ├── BAN 3 (sheet)
│   └── BAN 4 (sheet)
├── Primary viz (sheet)
└── Horizontal container — detail row (evenly distributed)
    ├── Secondary viz A (sheet)
    └── Secondary viz B (sheet)
```

### Sidebar Filter Layout

```
Horizontal container (root)
├── Vertical container — content (flexible width)
│   ├── Title (text object)
│   ├── Horizontal container — BAN row
│   └── Primary viz (sheet)
└── Vertical container — sidebar (fixed width ~250px)
    ├── Filter control
    ├── Filter control
    └── Parameter control
```

**Background color for visual grouping:** select a container → Layout pane → Background. Use `#F5F5F5` on the dashboard background and `#FFFFFF` on content group containers.

---

## Worked Examples

### Example 1: Executive KPI Dashboard (Z-Pattern, 1366x768)

**Audience**: Senior leadership reviewing weekly metrics
**Sizing**: Fixed 1366x768

```
┌──────────────────────────────────────┐
│  Dashboard Title                      │  36px
├────────┬────────┬────────┬───────────┤
│Rev $2.4M│Orders 1.2K│Margin 34%│NPS 72│  90px — BAN row
├──────────────────┬───────────────────┤
│ Revenue Trend     │ Revenue by Region │  310px
│ (line chart)      │ (filled map)      │
├──────────────────┼───────────────────┤
│ Top Products      │ Monthly Detail    │  310px
│ (bar chart)       │ (crosstab)        │
└──────────────────┴───────────────────┘
```

**Design decisions**: 4 BANs in distribute-evenly container. Revenue Trend at top-left as focal point. No sidebar filters — date controlled by a parameter in the BAN row.

---

### Example 2: Operational Analyst Dashboard (F-Pattern, 1366x768)

**Audience**: Operations analysts monitoring daily performance
**Sizing**: Vertical Scroll, 1366px wide

```
┌──────────────────────────────┬──────┐
│  Dashboard Title              │      │
├──────────────────────────────┤  F   │
│  Daily Volume Trend           │  i   │  450px — tall primary viz
│  (area chart)                 │  l   │
│                               │  t   │
├──────────┬───────────────────┤  e   │
│ By Status │ By Category       │  r   │  280px — secondary row
│ (donut)   │ (bar)             │  s   │
└──────────┴───────────────────┴──────┘
                                 250px
```

**Design decisions**: Sidebar at 250px fixed width holds 4 dropdown filters. Primary viz is tall (60% of content height). Blank spacer zones (8px) between primary and secondary rows.

---

### Example 3: Presentation Dashboard (Z-Pattern, 1920x1080)

**Audience**: Board presentation on a projector
**Sizing**: Fixed 1920x1080

```
┌───────────────────────────────────────────────┐
│           Quarterly Business Review             │  50px
├─────────────┬─────────────┬──────────┬────────┤
│  Revenue     │  Profit      │  Growth   │ Churn  │  120px — oversized BANs
│  $14.2M      │  $3.1M       │  +18%     │ 2.4%   │
├──────────────────────────┬────────────────────┤
│  Revenue by Quarter       │  Profit by Segment  │  430px
├──────────────────────────┴────────────────────┤
│  Regional Performance (horizontal bar)         │  430px
└───────────────────────────────────────────────┘
```

**Design decisions**: BAN row 120px (taller than normal) for readability at distance. Only 3 charts + 4 BANs — simplicity is critical for presentations. No filters — static snapshot for a specific period.

---

### Example 4: Compact Embedded Widget (Inverted Pyramid, 800x600)

**Audience**: Portal users viewing a summary widget
**Sizing**: Range, min 600x400 / max 1000x700

```
┌─────────────────────────────┐
│  Overall Score: 87 / 100     │  80px — single BAN
├──────────────────────────────┤
│  Score Trend (sparkline)     │  200px
├──────────┬───────────────────┤
│ By Team   │ By Category       │  300px
└──────────┴───────────────────┘
```

**Design decisions**: Inverted pyramid — key insight first. No title zone (portal provides its own header). No filters — controlled externally via URL parameters.

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

Use the sections above as the implementation reference for Tableau authoring. Apply the relevant pattern in the workbook or dashboard, then verify the result in Tableau for correctness, readability, and customer-safe behavior.

## Source and Confidence

- Source/evidence type: internal-doc
- Source: imported from prior Tableau authoring knowledge base (mbradbourne)
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-05-22
