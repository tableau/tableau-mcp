# Parameters & What-If Scenario Bands

Create a Tableau parameter, drive a reference line or a shaded scenario band from it, lay out a best / worst / expected what-if, and avoid the data-grain trap that makes a single scalar assumption silently wrong.

The XML mechanics behind an adjustable assumption: the parameter itself, the reference line/band it feeds, and the actual-vs-estimate scaffold that turns a projection into an override.

## Scope Check

- Primary audience: Tableau agent / SE authoring XML
- Authoring outcome improved: create, refine
- In-scope reason: A "what-if" / scenario request is a parameter feeding a reference line or band — a distinct, verifiable XML shape. Documents the confirmed node structure so the agent builds it instead of inventing a non-existent `<reference-band>` element.
- Out-of-scope risk: none
- Tags: parameter, what-if, scenario-band, reference-band, reference-line, best-worst-expected, expected-case, forecast-override, forecast-indicator, actual-vs-estimate, sensitivity, goal-seek, target-line, adjustable-target, paired-id, refband, param-domain-type, slider, data-grain
- Relevant user prompts/search terms: "add a what-if slider", "let me change the assumption and see the impact", "show a best case and worst case band", "shade the region between two targets", "forecast override so I can adjust the projection", "scenario analysis", "add a target line I can adjust", "sensitivity analysis on the growth rate", "band between two parameters", "expected vs best vs worst", "goal seek to a number", "let users tweak the growth rate and watch the line move", "actual vs estimate on one line", "shade an acceptable range on the chart"

## When to Use

Reach for this when the request implies an **adjustable numeric assumption** the user wants to *see on the viz*:

- "let me drag a slider for growth rate and watch the projection move" → parameter + a param-driven reference **line**.
- "show the acceptable range / best–worst window" or "shade between the low and high target" → a reference **band** (two paired lines, filled).
- "best / expected / worst case" → an expected line plus a best–worst band around it.
- "forecast override — keep actuals, let me set the estimate" → the actual-vs-estimate ("Forecast Indicator") scaffold plus a parameter for the estimate.

The tell: an input the user should be able to *change* (a target, a rate, a threshold) that must render as a line or shaded region — not a change to *which dimension value* is shown. If the ask is "switch the chart between Region / Segment / Metric on click", that is a categorical selector — use `tactics/dashboard/parameter-driven-views` instead. If they only want a static average/constant line, use `tactics/viz/filters`-adjacent `data/examples/reference-line.json` (no parameter needed).

## Best Practices

1. **Build the parameter first; it is the spine.** A parameter lives as a `<column>` in the special `Parameters` datasource (name is always exactly `Parameters`). Everything downstream — the line value, the band edges, the estimate calc — reads `[Parameters].[<name>]`. Author it before the reference line so the `value-column` has something to point at.
2. **A band is TWO paired reference lines, not a special node.** There is no `<reference-band>` element. Author two `<reference-line>` nodes that cross-reference via `paired-id`; the shaded fill of the region between them comes from a worksheet `<style-rule element='refband'>`. (Confirmed in `ww-ou-diff.xml` / `ww-ou-arrow.xml`.) A statistical spread band is instead a single `<reference-line>` with a distribution `formula` (`stdev`, `percentile`, `quantiles`, `confidence`) and `<reference-line-value>` children (confirmed in `control-chart-xmr.xml`).
3. **Best / expected / worst = one line + one band.** Model "expected" as a param-driven reference line and "best/worst" as a paired band whose two edges are two more parameters. Each edge reads a parameter through `value-column='[Parameters].[<name>]'` — the corpus-confirmed way to make a line value follow a parameter (`pareto-chart.xml`).
4. **Match the reference scope to the mark grain.** `scope` is `per-cell`, `per-pane`, or `per-table`. A per-row target (each category has its own target) needs `scope='per-cell'`; a single global target uses `per-table`. Mis-scoping is why a "target line" looks right at the total but wrong per bar.
5. **Prefer `value-column='[Parameters].[…]'` over `reference-parameter`.** The XSD defines a `reference-parameter` attribute, but it does not appear in any corpus workbook; the confirmed, portable form points `value-column` at the parameter. Treat `reference-parameter` as schema-only until a real workbook confirms it.
6. **A scalar parameter is uniform across the whole viz — respect the grain.** One `[Growth Rate]` parameter applies the *same* number to every mark. If the analysis needs different assumptions per segment (per-region growth, per-product target), a single parameter cannot express it — build an assumptions/scenario table in the data (one row per segment × scenario) and join/blend it, or map the scalar through a per-row calc. This is the UC4 "assumptions come off the data grain" caveat.

## Common Mistakes

1. **Inventing a `<reference-band>` element.** It does not exist in the TWB schema. Authoring one yields XML Tableau ignores or rejects. Use paired `<reference-line>` + `refband` style-rule, or a distribution reference-line.
2. **Forgetting `paired-id` (or pairing to a wrong id).** Two lonely reference lines are just two lines — no fill between them. Each of the two nodes must carry `paired-id` pointing at the other's `id`, and the band fill `<style-rule element='refband'>` must target one of those ids.
3. **Omitting a required attribute.** `<reference-line>` requires `id`, `axis-column`, `value-column`, `scope`, `label-type`, `z-order`, `formula`, and `enable-instant-analytics`. `formula` is required even for a param-driven line (use `average` on a scalar param — it resolves to the value).
4. **Wrong scope for the target grain.** Using `per-table` when each category needs its own target (or vice-versa) misrepresents the comparison. Set `scope='per-cell'` for a per-mark target.
5. **Expecting one scalar parameter to vary by dimension.** A single what-if % cannot encode per-region assumptions; users then wrongly read the uniform band as segment-specific. Use a scenario table when assumptions differ by grain.
6. **Confusing a numeric what-if with a dimension switcher.** Driving a *value* (target, rate) is this entry; switching *which dimension value* the viz shows is a different mechanic (`tactics/dashboard/parameter-driven-views`, `tactics/dashboard/parameter-actions`).

## Implementation

All snippets below are grounded in `data/twb_2026.1.0.xsd` and named corpus workbooks; `[federated.XXXX]` is the datasource-id placeholder (as in `data/examples/reference-line.json`). Fuller JSON exemplars: `data/examples/parameter.json` and `data/examples/reference-band.json`.

**1. Create the parameter** (a `<column>` in the `Parameters` datasource; confirmed shape from `data/examples/parameter.json` and the twb example index):

```xml
<datasource name="Parameters" inline="true">
  <column caption="Growth Rate" datatype="real" name="[Parameter 1]"
          param-domain-type="range" role="measure" type="quantitative" value="0.05">
    <calculation class="tableau" formula="0.05"/>
    <range granularity="0.01" min="-0.10" max="0.30"/>
  </column>
</datasource>
```

`param-domain-type` is `range` (min/max/granularity), `list` (explicit `<members>`), or `all` (unconstrained). The `value` attribute holds the current value; the `<calculation>` formula just echoes the default.

**2. A parameter-driven reference LINE — the "expected" case** (confirmed: `pareto-chart.xml` uses `value-column='[Parameters].[…]'`):

```xml
<reference-line id="refline0" formula="average" scope="per-table" label-type="value"
  axis-column="[federated.XXXX].[sum:Sales:qk]"
  value-column="[Parameters].[Expected Target]"
  z-order="1" enable-instant-analytics="true"/>
```

**3. A best/worst SCENARIO BAND — two paired param-driven lines + the fill rule** (structure confirmed in `ww-ou-diff.xml` / `ww-ou-arrow.xml`, edges param-driven per `pareto-chart.xml`):

```xml
<!-- inside panes > pane -->
<reference-line id="refline1" formula="average" paired-id="refline2" scope="per-table"
  label-type="value" symmetric="false"
  axis-column="[federated.XXXX].[sum:Sales:qk]"
  value-column="[Parameters].[Worst Case]"
  z-order="1" enable-instant-analytics="true"/>
<reference-line id="refline2" formula="average" paired-id="refline1" scope="per-table"
  label-type="value" symmetric="false"
  axis-column="[federated.XXXX].[sum:Sales:qk]"
  value-column="[Parameters].[Best Case]"
  z-order="1" enable-instant-analytics="true"/>
```

```xml
<!-- in the worksheet <style>, to shade the region between refline1 and refline2 -->
<style-rule element="refband">
  <format attr="fill-color" id="refline1" value="#e6f2ff"/>
</style-rule>
```

**4. A statistical distribution band** (single line, distribution edges as factors; confirmed in `control-chart-xmr.xml`) — use for a +/-nσ spread, not a user-driven what-if:

```xml
<reference-line id="refline1" formula="stdev" type="sample" scope="per-pane"
  label-type="automatic" fill-above="false" fill-below="false" symmetric="false"
  axis-column="[federated.XXXX].[sum:Profit:qk]"
  value-column="[federated.XXXX].[sum:Profit:qk]"
  z-order="2" enable-instant-analytics="false">
  <reference-line-value factor="-3"/>
  <reference-line-value factor="3"/>
</reference-line>
```

**5. The forecast-override (actual-vs-estimate) scaffold.** For "keep actuals, let me set the estimate", tag each row Actual vs Estimate on a `Forecast Indicator` dimension so one line runs history into a parameterized projection. Confirmed manual-sort shape from the twb example index (Actual before Estimate):

```xml
<sort class="manual" column="[none:Forecast Indicator:nk]" direction="ASC">
  <dictionary>
    <bucket>&quot;Actual&quot;</bucket>
    <bucket>&quot;Estimate&quot;</bucket>
  </dictionary>
</sort>
```

The `Forecast Indicator` field is a calc that returns `"Actual"` for observed rows and `"Estimate"` for projected rows; the projected measure reads the what-if parameter (e.g. `SUM([Actual]) * (1 + [Parameters].[Growth Rate])`). Put the indicator on Color to distinguish history from projection.

**Verify:** open in Tableau after applying — set the parameter(s) to their extremes and confirm the line/band edges move and the shaded region fills between the paired lines. If the fill is missing, `paired-id` or the `refband` style-rule id is wrong; if the target sits at the total but not per mark, fix `scope`.

## Related Knowledge

- `tactics/dashboard/parameter-driven-views.md` — when the parameter switches *which dimension value* is shown (a selector) rather than driving a numeric line/band value.
- `tactics/dashboard/parameter-actions.md` — click a mark to set a parameter (wire a what-if input from the viz).
- `tactics/data/calc-fields.md` — authoring the parameter `<column>` and the calc that reads it (the estimate/override formula).
- `tactics/viz/analytics-pane-reference.md` — the statistical *read* of a stdev / percentile / confidence distribution band (this entry owns the XML; that owns the stats).
- `strategy/viz-design/advanced-chart-builds.md` — the bullet graph (reference line + distribution band) and control-chart σ-band *builds* that use these nodes.
- Example JSON: `data/examples/reference-band.json` (band recipes), `data/examples/reference-line.json` (single line), `data/examples/parameter.json` (parameter creation).

## Source and Confidence

- Source/evidence type: schema + corpus verification
- Source: `data/twb_2026.1.0.xsd` (`reference-line` element / `ReferenceLine-G`, `ReferenceLineFormulaType-ST`, `refband` style-target enum) cross-checked against corpus workbooks `ww-ou-diff.xml`, `ww-ou-arrow.xml`, `control-chart-xmr.xml`, `pareto-chart.xml`, and the parameter shapes in `data/examples/parameter.json` + the twb example index (Forecast Indicator Actual/Estimate). No `<reference-band>` element exists in the schema; `reference-parameter` is schema-defined but absent from every corpus workbook, so the confirmed param-driven form is `value-column='[Parameters].[…]'`.
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-07-06

## Runtime Classification

- Knowledge type: authoring-expertise
- Runtime visibility: server-side-only
- Version binding: twb 2026.1.0
- Customer customization allowed: no
- Tool/API dependency: `tableau-apply-worksheet`, `tableau-apply-workbook`
- Eval candidate: yes
- Eval coverage: none
- Promotion target: authoring-expertise
