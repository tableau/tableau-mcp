# Advanced Chart Fallback Mechanics

Fallback-only mechanics for advanced/"hacked" chart types after the validated template path cannot apply — mark type, shelf setup, key calculations, and the addressing that makes or breaks each one.

The fallback build-mechanics layer beneath chart choice: chart-selection decides *which* chart; `bind-template` gets the first chance to construct it, and these recipes apply only after bind proposes or escalates.

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: create
- In-scope reason: Once chart-selection has decided *which* advanced chart answers the question, this gives the concrete build — mark type, shelves, calcs, Compute Using — so the agent can construct sankey/waterfall/bump/bullet/dumbbell/etc. instead of only naming them.
- Out-of-scope risk: none
- Tags: advanced-charts, chart-builds, dual-axis, table-calculations, densification, pareto, bump, waterfall, dumbbell, sankey, bullet-graph, small-multiples, marimekko, donut, compute-using
- Relevant user prompts/search terms: "how do I build a sankey", "make a waterfall chart", "bump chart", "dumbbell chart", "bullet graph", "Pareto chart", "control chart", "small multiples", "build a funnel", "radial bar chart", "donut chart", "dual axis combo chart", "lollipop chart", "marimekko"

## When to Use

For any named chart type, call `bind-template` with `auto_apply: true` **FIRST**. The shelf/XML recipes below are **FALLBACK-ONLY**, after bind returns propose or escalate; do not pre-author a chart's template-owned calculations (including a waterfall's running total) before binding.

Use this fallback when bind cannot apply the requested advanced chart and you need the mechanic — mark type, shelf layout, calculations, and table-calc addressing. For *which* chart the question calls for (and whether to push back on a poor choice), see [Chart Type Selection](data/knowledge/strategy/viz-design/chart-selection.md); for the calc formulas behind these (running total, rank, LOD, sigmoid), see [LOD & Table-Calc Pattern Cookbook](data/knowledge/tactics/data/lod-and-table-calc-patterns.md); charts needing reshaped/densified input cross-reference data-modeling (a `data/knowledge/data-modeling/` follow-up).

## Best Practices

### Foundations you reuse constantly

**Mark type is the primary lever.** Quick map: Bar (bar/histogram/stacked), Line (time/slope/bump/sparkline), Area (area/centered funnel), Square (highlight table/heat map/treemap), Circle (scatter/jitter/dumbbell ends/lollipop heads), Gantt Bar (timeline/**waterfall**), Pie (pie/donut/pie-on-map), Polygon (custom maps/sankey curves/radial fill), Density (point-cloud heat maps), Map (filled choropleth).

**Combining measures — the backbone of most advanced charts:**
- **Individual axes:** drag multiple continuous measures to Rows/Columns — separate panes, independent scales.
- **Blended axis:** drop one measure onto an existing axis (double-ruler indicator) — shared axis via Measure Names/Values.
- **Dual axis:** two overlaid axes in one pane. Right-click the 2nd pill → **Dual Axis**, then right-click axis → **Synchronize Axis** (only enabled when both are the same numeric type). **Move Marks to Back/Front** controls layering. Dual axis auto-adds Measure Names to Color — remove it for independent per-measure encoding.

**⚠ Table-calc addressing is the #1 failure mode** for Pareto, bump, marimekko, trellis, sankey, radial. Set **Compute Using / Specific Dimensions** explicitly — the default direction is usually wrong. Verify by opening.

### Table-calc chart recipes (no reshaping)

- **Combo chart:** two measures on Rows → Dual Axis → set each Marks card's type independently (e.g. Profit→Bar, Sales→Line) → Synchronize. The building block for bullet/Pareto/bump/dumbbell/control.
- **Pareto:** Sub-Category on Columns sorted descending by SUM(Sales); Sales on Rows (bars); second Sales to far right → Dual Axis → Line; on the line, Add Table Calc = **Running Total**, then Secondary = **Percent of Total**, Compute Using = Table (Across). Add 80%/20% reference lines.
- **Bullet graph:** bar of actual by category; drag a **Reference Line** from Analytics → **Cell**, value = target; drag a **Distribution** band → Cell at 60%/80% of target. Scope **Per Cell** so each row's target is independent.
- **Bump chart (rank over time):** continuous date on Columns, SUM(Sales) on Rows, dimension on Color; Quick Table Calc → **Rank**, Compute Using = the dimension, restart each date period, Descending; duplicate pill → 2nd to **Shape** → Dual Axis → Synchronize; **Edit Axis → Reversed** so rank 1 is on top.
- **Slope chart:** filter date to exactly two periods (discrete on Columns); measure on Rows; category on Color + Path; hide inner axis; label only ends with `FIRST()=0`/`LAST()=0`.
- **Dumbbell:** measure on Columns, category on Rows, comparison dim filtered to two members on Color (Circle); duplicate measure → Line, move comparison dim to **Path**; Dual Axis → Synchronize; line behind circles. (A lollipop connects one dot to the baseline; a dumbbell connects two dots.)
- **Waterfall:** steps dimension on Columns, measure on Rows → Quick Table Calc **Running Total** → mark type **Gantt Bar** → create `-[Measure]` and put it on **Size** (without the negative-size field the bars won't connect into the staircase); signed measure on Color for up/down. Bridge/P&L datasources often carry subtotal/total rows (usually tagged by a category/row-type column); before the Running Total, filter to incremental rows only — or render subtotal/total rows as anchors where the mark shows the full running value, not a signed increment. Running-totaling all rows double-counts every summarized increment and the final bar lands near 2× the true net. **The running total is order-dependent, so the step order is load-bearing:** when the intended order is a non-displayed field (e.g. a `display_order`/sequence column that isn't on a shelf), carry it in the ORIGINAL bind — `bind-template` proposal `sort:{by:"display_order",direction:"asc"}` injects that field's sort even though it isn't an encoding. Do NOT bind first and then reach for `refine-worksheet` to fix the order — refine can only sort by a field already in the view, so sorting by an off-view sequence field there fails ("unknown sort-by field") and the bridge stays in the template's default DESC-by-measure order.
- **Funnel:** stage on Rows, measure on Columns → **Area**; create `-[Measure]` and drop it on Columns *in front* → symmetric centered funnel; color by stage, label with % of first stage.
- **Control chart:** line per category (date on Columns, measure as Average); Dual Axis a Circle layer; Analytics **Average line** Per Pane + **Standard Deviation** distribution (factor 1–3, parameter-driven); color marks by an outlier calc (`AVG > WINDOW_AVG + nσ·WINDOW_STDEV`). (For how to read the σ band / what the stats mean, see [Analytics Pane Reference](data/knowledge/tactics/viz/analytics-pane-reference.md) — it owns the statistical read; this owns the build.)
- **Small multiples / trellis:** parameter `Total Columns`; `Column = (INDEX()-1) % [Total Columns]`, `Row = ((INDEX()-1) - [Column]) / [Total Columns]`; Column (discrete) on Columns, Row (discrete) on Rows, per-plot fields in front; **set all three layout calcs' Compute Using to only the per-plot dimension** or the grid scrambles.
- **Marimekko:** percent-of-total SUM(Sales) (Compute Using Category) on Rows as Bar; `{FIXED [Region]: SUM([Sales])}` for width; a running-width calc on Columns (Compute Using Region); Regional Sales on **Size** → Fixed, align Right; Category on Color.
- **KPI/BAN card:** Text mark, measure on Text/Label, huge font; a % -change calc below colored by direction; a ▲/▼ Shape; often paired with a bullet graph.

### Native / Show Me (no recipe needed, just the gotcha)

Histogram (bin on Columns, CNT on Rows), box plot (**disaggregate** via `Analysis ▸ Aggregate Measures` off or it flattens — the quartile/whisker stat read is in [Analytics Pane Reference](data/knowledge/tactics/viz/analytics-pane-reference.md)), highlight table/heat map (Square + measure on Color, add 2nd measure on Size for heat), density (Density mark, **no color legend**), treemap/packed bubbles (Show Me one-clicks), filled vs symbol map (filled distorts by area — prefer symbol for counts).

### Reshape/densification charts (heavier — budget time)

These need densification (a size-1 **bin** Tableau interpolates across) or reshaping (self-union/scaffold). Keep the scaffold workbook as the source of truth — changing bin size or filtering padding rows breaks the curves.
- **Sankey:** Polygon curves + Gantt end nodes; scaffold each flow record, densify with a `t` bin (1..49), a **sigmoid** calc maps `t` to the S-curve, FIXED/rank calcs position each flow. Prefer the simpler Equal-Width Sankey for modern use.
- **Radial bar:** self-union (start/end point per bar) + densification; `Angle = (INDEX()-1)·(1/WINDOW_COUNT(...))·2π`; `X = radius·COS(Angle)`, `Y = radius·SIN(Angle)`; Line mark, item dim on Path. INDEX/WINDOW_MAX/RANK_UNIQUE are table calcs — Compute Using along the densification bin or the geometry breaks. (Verified against real radial `.twb` files.)
- **Donut/gauge:** dual-axis pies — a `MIN(1)` placeholder axis duplicated; the top pie loses its dimension, recolors to the background, and shrinks via Size to punch the hole; total on Label. No native gauge mark.
- **Spatial O-D flow (modern, no reshaping):** `MAKELINE(MAKEPOINT([OLat],[OLon]), MAKEPOINT([DLat],[DLon]))` — one line mark per route (latitude **first** in MAKEPOINT). The native alternative to densified-path sankey hacks; needs a spatial-capable source.

## Common Mistakes

- **Skipping Compute Using** — the #1 failure mode for every table-calc chart; the default addressing direction is usually wrong (Pareto/bump/marimekko/trellis).
- **Waterfall without the negative-size field** → disconnected bars instead of a staircase.
- **Waterfall over subtotal/total rows without filtering or anchoring** → the bridge double-counts (final bar ≈ 2× true net). Check for a category/row-type column before running-totaling.
- **Ordering a waterfall by a non-displayed sequence field via refine instead of the bind** → refine-worksheet only sorts by fields already on the view, so `sort by "display_order"` fails there and the bridge silently stays in default DESC-by-measure order. Put the order in the bind proposal's `sort:{by,direction}` up front.
- **Box plot left aggregated** → a single flat mark; disaggregate.
- **Dual axis not synchronized** (or can't be, mismatched types) → silently misrepresents the comparison.
- **Forgetting Edit Axis → Reversed** on bump/slope → the "winner" sits at the bottom.
- **Clicking Show Me after hand-building** → resets manual mark/shelf work.
- **Filled (choropleth) map for raw counts** → area dominates over value; use symbol/size or normalize per-capita.

## Implementation

Call `bind-template(auto_apply:true)` first for the named chart. Only after bind returns propose or escalate should you use the matching fallback recipe above; then set table-calc **Compute Using** explicitly (this is where most advanced charts fail), apply via `apply-worksheet` / `apply-workbook(mode=file)`, and open in Tableau to confirm the geometry/addressing rendered as intended. For reshape/densification charts (sankey, radial, network), keep the scaffold as the source of truth and verify the curve interpolation didn't break. Defer chart *choice* to chart-selection and the perceptual *why* (bars over pies, shared over dual axis, color for secondary encoding) to the design-principles guidance.

## Related Knowledge

- Builds on [Chart Type Selection](data/knowledge/strategy/viz-design/chart-selection.md): that decides *which* chart and flags poor choices; this is *how to build* the advanced ones.
- Uses the calc recipes in [LOD & Table-Calc Pattern Cookbook](data/knowledge/tactics/data/lod-and-table-calc-patterns.md) (running total, rank, LOD for marimekko/sankey positioning) — the addressing rules there are the same ones that make or break these charts.
- The control-chart / density mechanics relate to [Analytics Pane Reference](data/knowledge/tactics/viz/analytics-pane-reference.md) (Standard Deviation distribution, density marks).
- The bullet-graph target and control-chart σ band are authored with the nodes in [Parameters & What-If Scenario Bands](data/knowledge/tactics/data/parameters-and-scenario-bands.md) — the `<reference-line>` XML, `paired-id` bands, and parameter-driven line values.
- Pairs with [Chart Best Practices](data/knowledge/strategy/viz-design/chart-best-practices.md) for the simpler-chart conventions.

## Source and Confidence

- Source/evidence type: external reference (adapted with permission)
- Source: adapted from `plugin-tableau-master` (`references/advanced-visualizations.md`) by Jon Plax, used with the author's permission; build recipes trace to help.tableau.com plus community sources (Flerlage Twins, The Data School, Playfair Data) and dissection of real `.twb` files (radial-bar recipe verified against real workbooks). Condensed from the 500-line source to the load-bearing mechanic + failure mode per chart. For the densification-heavy charts (sankey, network, radial), this entry deliberately points to the *simpler native alternatives* (Equal-Width Sankey, `MAKELINE` O-D maps) rather than reproducing the full scaffold — when a user needs the full step-by-step for a complex hacked chart, build from a known-good reference workbook (`get-workbook-xml` on a real example) plus the community recipes cited above, not from this condensed entry alone.
- Customer-identifying details removed: n/a
- Confidence: draft
- Last reviewed: 2026-06-19

## Runtime Classification

- Knowledge type: authoring-expertise
- Runtime visibility: server-side-only
- Version binding: none
- Customer customization allowed: no
- Tool/API dependency: `apply-worksheet`, `apply-workbook`
- Eval candidate: yes
- Eval coverage: none
- Promotion target: authoring-expertise
