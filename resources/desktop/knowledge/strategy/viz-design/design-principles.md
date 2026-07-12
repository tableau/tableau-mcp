# Visual Design Principles: The Perceptual Why

The perceptual research behind why one encoding is more truthful or readable than another — Cleveland & McGill, Bertin, Tufte, Few, Gestalt, color science.

The judgment layer that the opinionated rules in chart-selection, color-strategy, and chart-best-practices *cite*: this explains the why; those apply the what. Don't restate them here.

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: create, refine
- In-scope reason: When the agent recommends "bars over pies" or "gray default + one accent" or "keep zero on bars," this is the perceptual evidence behind it — so guidance is grounded reasoning a user can be shown, not bare assertion, and the agent knows when a rule legitimately bends.
- Out-of-scope risk: none
- Tags: visual-design, perception, cleveland-mcgill, bertin, tufte, few, gestalt, color-science, pre-attentive, lie-factor, design-rationale
- Relevant user prompts/search terms: "why bars instead of pie", "why is this chart misleading", "why gray default one accent", "perception hierarchy", "is dual axis bad", "why keep zero on a bar axis", "what encoding should this be", "why not rainbow colors", "is this design good"

## When to Use

Use this to ground a design recommendation in *why* — when a user asks "why not a pie?", "is this dual axis a problem?", or you need to justify pushing back on a poor encoding. It is the rationale layer; the applied rules live elsewhere: chart choice in [Chart Type Selection](data/knowledge/strategy/viz-design/chart-selection.md), palette types/CVD/contrast in [Color Strategy](data/knowledge/strategy/viz-design/color-strategy.md), formatting/gridlines in [Formatting & Professional Polish](data/knowledge/strategy/viz-design/typography-and-polish.md), build recipes in [Advanced Chart Build Recipes](data/knowledge/strategy/viz-design/advanced-chart-builds.md). Don't restate those here — point to them.

> **These are schools of thought, not commandments.** Tufte (data-ink minimalism), the memorability researchers ("useful junk"), and Few (pie absolutism) genuinely disagree at the edges. Each principle is one well-argued default, strongest in its context (analytical/monitoring) and weaker in others (persuasion/journalism). Where the field disagrees, this says so. The only decisive test: put the design in front of the audience and watch whether they read it right.

## Best Practices

### The perception hierarchy (Cleveland & McGill, 1984)

The empirical spine: elementary perceptual tasks ranked by how *accurately* people decode them (Heer & Bostock 2010 broadly replicated the ordering), most → least accurate:

1. **Position along a common scale** (aligned bars, dot plots)
2. **Position along non-aligned identical scales** (small multiples)
3. **Length, direction, angle** (unaligned bars; pie slice angles)
4. **Area** (bubbles, treemaps)
5. **Volume, curvature** (3-D)
6. **Color saturation / shading** — least accurate

**Why the rules are the rules:** a bar (rank 1) beats a pie (rank 3) for any comparison the viewer must judge precisely → prefer position (a measure on Rows/Columns) before Size or Color. A shared axis (rank 1) beats a dual axis (rank 2 + the crossing illusion). Color and size are for **secondary, low-precision** encoding — category hue or rough magnitude, never a value read off accurately. Avoid 3-D entirely (rank 5). **Caveat:** the ranking is for *precise value extraction* — for "spot the cluster/outlier/shape," a dense scatter or heatmap can beat a long bar list; don't quote exact error percentages.

### Bertin's visual variables — what each encoding *can* mean

The theory under the Marks card. Four properties decide which data role a variable can carry:

| Property | Has it | Lacks it |
|---|---|---|
| **Selective** (isolate a group instantly) | hue, size, value, position, orientation | **shape** |
| **Associative** (still reads as one group when varied) | hue, shape, orientation, texture | size, value |
| **Ordered** (reads as a sequence, no legend) | size, value, position | **hue** (no natural order) |
| **Quantitative** (supports "twice as big") | **position, size** | most others |

**Marks-card mapping:** quantitative measure → Rows/Columns (position) best, then Size, then sequential color *value* for low precision. Ordered → position/size/sequential palette, **never hue**. Nominal → **hue** (selective + associative), or shape for ≤~6 categories but pair with color since shape isn't selective. Label/Text isn't a Bertin variable but is the honest way to deliver an exact value. **Caveat:** size "quantitative" is aspirational — size judgments obey Weber's law (below), so they're approximate.

### Tufte — graphical integrity and the discipline of less

- **Data-ink ratio** = data-ink / total ink; "above all else show data; erase non-data-ink; erase redundant data-ink." → cut gridlines/borders/shading (the *mechanics* are in typography-and-polish); direct-label instead of a legend where it declutters.
- **The Lie Factor** = effect shown / effect in data; honest ≈ 1.0. → bars **must include zero** (length encodes from a common baseline); label units; deflate money to constant dollars.
- **Small multiples**: "Compared to what?" — visually enforce comparison; synchronize axes so panels compare.
- **Chartjunk** — decoration that dominates the data ("the duck," moiré, heavy grids).

**Where Tufte is contested (don't present minimalism as settled):** the "useful junk?" research (Bateman 2010, Borkin 2013) found embellished/memorable charts recalled *better* with no accuracy penalty — so pure minimalism optimizes comprehension, **not** retention; for journalism/marketing, controlled embellishment can be right. Few keeps faint gridlines because they aid value lookup (Heer & Bostock agree). **Accessibility outranks minimalism** when they conflict. Tufte wrote for print — interactivity (tooltips, drill) lets you keep the overview clean and put detail on demand.

### Few — the bullet graph rationale + pre-attentive emphasis

Few applied the perception research to dashboards. The lasting ideas: **a number with no context (target/prior/benchmark) is meaningless**; **gray as the default + one accent hue** for what needs attention (vary intensity not hue for ordered data); override Show Me's pie/gauge suggestions. The **bullet graph** (his invention, replaces gauges) is *why* it works: a single linear quantitative scale (position, rank 1), a comparative target marker, and 2–5 qualitative bands in **shades of one hue** (not traffic lights — colorblind-hostile). The build is in advanced-chart-builds; this is the rationale. **Pre-attentive attributes** (perceived <250ms): color, form, 2-D position, motion — use *one* to make the key mark pop; a conjunction (red **and** square) forces slow serial search, so gray-everything + color-the-one-mark is pop-out done right. **Caveat:** Few's pie/gauge absolutism softens for a 2–3-slice part-to-whole; "single screen, monitor" excludes analytical dashboards that legitimately drill.

### Gestalt, pre-attentive, and Weber's law

**Gestalt grouping** → layout: **proximity** (near = related; group with padding/whitespace, not borders), **similarity** (a measure is the same hue everywhere), **enclosure** (subtle shading/border groups a section), **continuity** (align edges; a line literally connects — slope, dumbbell, flow), **figure/ground** (saturated data on a quiet background). **Weber's law / JND:** the smallest noticeable difference is ~proportional to magnitude (size ≈10%, lightness ≈8%) — so **don't encode fine distinctions with bubble size or color bins** (100/105/110 are indistinguishable as bubbles); use bars. Keep size legends where the largest is ≥~2× the smallest's area; keep color to ≤~5–7 stepped bins.

### Distortion — the mechanism, and the Tableau setting that causes it

- **Truncated axis:** bars encode length from zero — a non-zero baseline inflates the ratio and lies. Keep zero on bars (don't uncheck "Include zero" on Edit Axis). Lines encode by position, so a non-zero baseline can be legitimate *if labeled*.
- **Dual-axis deception:** two unrelated measures on independent scales can be made to "cross" anywhere by choosing scales — a manufactured correlation. Prefer a shared/blended axis or index both to a common base (% change); if you must dual, synchronize and label.
- **Area exaggeration:** doubling a value doubles a bubble's *area* but radius grows as √ — viewers over-read big bubbles. Rough-only, or use bars.
- **Overplotting:** dense scatters occlude — use opacity, density marks, or small multiples.
- **Banking to ~45°** (Cleveland): slope judgments are most accurate when average segment slope is near 45°; adjust the worksheet aspect ratio (no auto-bank in Tableau).

## Common Mistakes

- Presenting a heuristic as a law — quoting "bars beat pies" without the perceptual *why*, or stating minimalism as settled when the memorability research contests it.
- Encoding a value the viewer must read precisely with color or area (rank 4–6) instead of position/length (rank 1–3).
- Spending every pre-attentive attribute at once (rainbow every category) so nothing pops — instead of gray-default + one accent.
- Using hue for *ordered* data (hue has no natural order) instead of a sequential lightness palette.
- Encoding fine distinctions with bubble size despite Weber's law.
- Letting minimalism override accessibility (color-alone encoding, sub-contrast labels).

## Implementation

When recommending or critiquing an encoding, reason from the judgment the viewer must make: precise comparison → position/length; rough structure → area/color with drill for exact. Match medium to message, encode by data role (Bertin), spend attention deliberately (one accent), don't lie (zero baseline, no deceptive dual axis), declutter within reason (accessibility wins), and verify by showing it to a real viewer. Apply the *applied* rules from the sibling entries — this entry supplies the rationale to cite, not a second copy of those rules. For a structured review/redesign pass, this is the lens behind a critique.

## Related Knowledge

- Grounds the opinionated rules in [Chart Type Selection](data/knowledge/strategy/viz-design/chart-selection.md) (why bars > pies, shared > dual axis) and [Chart Best Practices](data/knowledge/strategy/viz-design/chart-best-practices.md).
- Supplies the *why* behind [Color Strategy](data/knowledge/strategy/viz-design/color-strategy.md) (sequential vs hue, CVD, rainbow-is-broken) and [Formatting & Professional Polish](data/knowledge/strategy/viz-design/typography-and-polish.md) (data-ink, gridlines) — those own the applied palettes/formatting; this owns the perceptual reason.
- The bullet-graph and small-multiples *builds* are in [Advanced Chart Build Recipes](data/knowledge/strategy/viz-design/advanced-chart-builds.md); the *rationale* is here.
- Complements the statistical-honesty layer in chart-selection (Statistical Traps) — that catches reasoning errors, this catches perceptual/encoding errors.

## Source and Confidence

- Source/evidence type: external reference (adapted with permission)
- Source: adapted from `plugin-tableau-master` (`references/visual-design-principles.md`) by Jon Plax, used with the author's permission; underlying research is Cleveland & McGill (1984), Bertin (Semiology of Graphics), Tufte (VDQI/EI/Beautiful Evidence), Few (Show Me the Numbers / Information Dashboard Design), Gestalt, and color science (ColorBrewer, viridis). Palette tables, chart-selection heuristics, and the bullet-graph build deliberately left to the sibling entries that own them.
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
