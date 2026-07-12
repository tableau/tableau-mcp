# Analytics Pane Reference: Trend, Forecast, Cluster, Reference Lines

How to add Tableau's built-in statistics — trend lines, forecasting, clustering, reference/distribution bands, box plots — and read each output *honestly*.

Covers the statistics Tableau computes for you, the stat functions you write yourself (CORR, the WINDOW_* family), and the limits that keep them from producing a confident-but-wrong dashboard.

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: create, validate
- In-scope reason: Frequently-asked "how do I add a trend line / forecast / cluster, and what does the output actually mean" — backs the statistical-trap and EDA guidance in chart-selection with the concrete Analytics-pane mechanics and the honest read of each model.
- Out-of-scope risk: none (TabPy/Rserve/Einstein analytics *extensions* deliberately omitted — that's data-science integration, not Desktop authoring)
- Tags: analytics-pane, trend-line, forecast, clustering, reference-line, distribution-band, box-plot, control-chart, r-squared, p-value, confidence-interval, statistical-functions
- Relevant user prompts/search terms: "add a trend line", "what does R squared mean", "how to forecast in Tableau", "is this forecast any good", "k-means clustering", "add a reference line", "confidence interval band", "box plot", "control chart", "standard deviation band", "CORR / WINDOW_CORR", "z-score outliers"

## When to Use

Use this when a user wants to add a built-in statistic from the Analytics pane (trend/forecast/cluster/reference line/box plot) or compute a statistic in a calc (CORR, STDEV, WINDOW_*), and needs both the mechanic *and* the honest interpretation. For *which* analysis a question needs and the statistical traps, see [Chart Type Selection](data/knowledge/strategy/viz-design/chart-selection.md) (Statistical Traps + EDA-First sections); for the calc recipes behind cohort/Pareto/ranking, see [LOD & Table-Calc Pattern Cookbook](data/knowledge/tactics/data/lod-and-table-calc-patterns.md).

## Best Practices

### The Analytics pane — what Tableau computes for you

Drag from the **Analytics pane** (left rail, second tab next to Data) onto the view; items snap into Table / Pane / Cell or per-axis drop zones, computed by the stats engine at render time (no calc). Right-click the result → **Edit** for its dialog; **Describe Trend Model / Describe Forecast / Describe Clusters** expose the underlying numbers.

| Item | What it adds | The honest read |
|---|---|---|
| Trend Line | a fitted model line + optional confidence bands | R² + p-value in the tooltip; not causation |
| Forecast | future periods via exponential smoothing | GOOD/OK/POOR quality; bands = precision, not accuracy |
| Cluster | k-means group as a discrete pill on Color | deterministic; auto-k can't return k=1 |
| Reference Line / Band / Distribution | constant/computed line, shaded band, box plot, control limits | defines the comparison baseline |

### Trend lines

Five model types (both axes must be numeric — a continuous green date is fine; a cube string date is not):

| Model | Fitted form | Use when |
|---|---|---|
| Linear | `Y = b0 + b1·X` | constant absolute change |
| Logarithmic | `Y = b0 + b1·ln(X)` | diminishing returns; X > 0 |
| Exponential | `Y = exp(b0)·exp(b1·X)` | constant % growth/decay |
| Power | `Y = b0·X^b1` | scale-free / allometric |
| Polynomial | `Y = b0 + b1·X + b2·X² + …` | curvature; degree 2–8 |

Constraints: **Logarithmic/Exponential/Power silently filter out non-positive values** before fitting; **confidence lines aren't supported for Exponential**; higher-degree polynomials need more data and overfit by construction. **Reading R²/p:** R² = how well the line fits *these* points; p ≤ 0.05 is the usual "significant" convention, but its validity rests on i.i.d. errors — time-series (autocorrelated) data violates that, so a "significant" trend on monthly sales is weaker than the number suggests. Hover for R²/p, or right-click → **Describe Trend Model** for per-term coefficients.

### Forecasting (exponential smoothing)

Analytics pane → **Forecast** (needs ≥1 date dimension + ≥1 measure). Tableau fits up to **8 models (5 seasonal + 3 non-seasonal, Holt-Winters family)** and returns the lowest **AIC**. Data minimums: **≥5 points** for trend; for seasonality, **whichever is larger** of two full seasons or one season + 5 periods — i.e. **9 points for a 4-quarter cycle** (max of 8 and 9) and **24 for a 12-month cycle** (max of 24 and 17). (Provision to the per-cycle minimum; *verify against help.tableau.com.*) A **multiplicative model can't compute when any value ≤ 0**.

**Read the quality indicator first** (Describe Forecast → Summary): **GOOD/OK/POOR** measured against a naive forecast (next = current). OK = better than naive; GOOD = less than half naive's error; POOR = no better than naive. **The prediction band is precision, not accuracy** — a tight band around a POOR forecast is tightly wrong. Never present a band edge as a worst/best-case guarantee. **Forecast Options** sets model, length, and interval (90/95/99%).

### Clustering (k-means)

Analytics pane → **Cluster** drops a deterministic k-means group onto Color. Key facts: **Lloyd's algorithm, squared Euclidean distance**; **deterministic** (divisive initializer, not random seed — same inputs + k → same clusters); inputs are **min-max normalized to [0,1]** (so a single outlier stretches the range — check distributions first); **auto-k via Calinski-Harabasz**, which is **undefined for k=1 and so can never tell you "don't split"** — it will hand you ≥2 groups even if the data isn't clustered. Validate with **Describe Clusters** (between/within sum-of-squares, per-variable ANOVA F + p); try k−1 and k+1; sanity-check the groups mean something. Drag the field to the Data pane to persist it as a group.

### Reference lines, bands, distributions, box plots

Right-click axis → **Add Reference Line**, or drag from the pane. A **reference distribution** has four types: Percentages, Percentiles, Quantiles, Standard Deviation.
- **Box plot** (Analytics pane → Box Plot, or Show Me) = the middle 50% (Q1–Q3) as the box. Whiskers: "within 1.5× IQR" (schematic, outliers drawn individually) or "maximum extent" (skeletal). The no-calc path to the five-number summary — **disaggregate** (`Analysis ▸ Aggregate Measures` off) or it's a flat single mark.
- **Control chart (mean ± Nσ)**: build from a **Standard Deviation reference distribution** — set the **factor** (e.g. 3 for ±3σ) and **sample vs population**, plus a Median/Average center line. (Tableau exposes this as a reference-distribution option, not under a "control chart" label.)

### Statistics you write yourself

When you need the number *in* a calc (to label/filter/drive logic), not as a drawn line:

- **Aggregate (data engine):** `CORR(a,b)` (Pearson −1…1), `COVAR`/`COVARP`, `STDEV`/`STDEVP`, `VAR`/`VARP`. **Sample (n−1) vs population (n)** matters — use sample when rows are a sample of a larger universe. **Source-gated:** these run only on extracts + specific live connectors (BigQuery, Oracle, Postgres, Presto, Teradata, Vertica…). On an unsupported live source, extract or use the WINDOW_* fallback.
- **Windowed (table calcs):** `WINDOW_PERCENTILE`, `WINDOW_STDEV`/`WINDOW_STDEVP`, `WINDOW_VAR`/`WINDOW_VARP`, `WINDOW_MEDIAN`, `WINDOW_CORR`, `WINDOW_COVAR`. Partition/address controls the scope (see the cookbook).
- **Z-score** (no built-in): `(SUM([M]) - WINDOW_AVG(SUM([M]))) / WINDOW_STDEV(SUM([M]))`, then `|z| > 2` (or 3) flags outliers — the control-chart logic as a calc.

### Honest interpretation — the model's limits

The most valuable thing this does is stop a powerful tool from asserting something false:
- **Overfitting:** a degree-8 polynomial can hit R²≈1 on noise. Prefer the simplest model that fits; hold out recent periods and see if it still tracks.
- **Extrapolation:** a fit is evidence only within the observed X range; label forecast regions, state the assumption, shorten the horizon.
- **Forecast bands ≠ guarantees:** show the GOOD/OK/POOR badge next to any forecast.
- **Correlation ≠ causation:** a scatter+trend line is the most seductive place to imply cause; annotate the confounder, avoid causal verbs in the title.
- **i.i.d. violations** (time-series/clustered data) inflate significance — treat trend p-values on time series as directional, not decisive.
- **Clusters always appear** (auto-k can't return 1; scaling can manufacture separation) — read the ANOVA/SS before believing them.

## Common Mistakes

- Trusting a forecast's tight confidence band without checking the GOOD/OK/POOR quality indicator — a tight band on a POOR forecast is tightly wrong.
- Reading R² as "importance" or a small p as a big effect / proof of cause; on large n almost everything is "significant."
- Believing a cluster result because Tableau returned one — auto-k can't tell you the data *isn't* clustered.
- Building a box plot without disaggregating (`Aggregate Measures` off) → a single flat mark.
- Using `CORR`/`STDEV` on an unsupported live source and getting an error instead of switching to `WINDOW_*` or extracting.
- A multiplicative forecast / log-or-power trend on data with ≤0 values (silently filtered or uncomputable).

## Implementation

Pick the Analytics-pane item for the analytical need, drop it on the view, then **read its honesty surface before presenting**: Describe Trend Model (R²/p per term), Describe Forecast (quality + smoothing coefficients), or Describe Clusters (SS + ANOVA). For a layered analytical dashboard: distribution first (box plot/histogram — see spread, not just a mean), then relationship (scatter + trend line, confounder annotated), then trend + forecast with its quality badge, then a cluster validated by Describe Clusters, then a control/outlier band, plus honesty furniture (quality indicators, "data through <date>", non-causal titles). Wire interactivity per the analytical archetype in [dashboard-archetypes](data/knowledge/strategy/dashboard-design/dashboard-archetypes.md).

## Related Knowledge

- Backs the statistical-trap and EDA-First sections of [Chart Type Selection](data/knowledge/strategy/viz-design/chart-selection.md) with the concrete Analytics-pane mechanics they reference (this is the entry that file's "forthcoming analytics-pane reference" pointer was waiting on).
- Complements [LOD & Table-Calc Pattern Cookbook](data/knowledge/tactics/data/lod-and-table-calc-patterns.md): cohort/Pareto/ranking calc recipes there; the windowed stat functions (`WINDOW_CORR`, `WINDOW_STDEV`) bridge the two.
- Used by the analytical-dashboard recipe in [Dashboard Archetypes & Build Blueprints](data/knowledge/strategy/dashboard-design/dashboard-archetypes.md).

## Source and Confidence

- Source/evidence type: external reference (adapted with permission)
- Source: adapted from `plugin-tableau-master` (`references/advanced-analytics-in-tableau.md`) by Jon Plax, used with the author's permission. The source verified every model name, function signature, and threshold against help.tableau.com via a 3-vote adversarial pass; items it could not confirm are not carried here. §7 (TabPy/Rserve/Einstein extensions) deliberately omitted as out-of-scope for Desktop authoring.
- Customer-identifying details removed: n/a
- Confidence: draft
- Last reviewed: 2026-06-19

## Runtime Classification

- Knowledge type: authoring-expertise
- Runtime visibility: server-side-only
- Version binding: none
- Customer customization allowed: no
- Tool/API dependency: none
- Eval candidate: yes
- Eval coverage: none
- Promotion target: authoring-expertise
