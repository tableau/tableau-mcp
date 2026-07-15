# Discrete Groups vs. Gradient: Encode "Which Group", Not the Raw Measure

Strategy guide for one high-leverage encoding decision: when a request is about **membership in a few distinct groups** (tiers, bands, top/bottom/middle, segments, pass/fail), color (or shape) must encode the **group**, not the underlying continuous value. Tool-agnostic design intent; it does not cover continuous heatmaps or single-measure gradients, which are legitimately gradient work.

Enforced-by: redundant-color-encoding

**Tactics companion:** `expertise://tableau/tactics/viz/marks-and-encodings` — the discrete-tier color XML and the gradient-vs-discrete encoding forms ("Discrete-tier color").

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: create, refine
- In-scope reason: Guides Claude to choose discrete color encodings (groups) vs. gradients so membership-based requests (top/bottom tiers) render correctly.
- Out-of-scope risk: none
- Tags: color, discrete-color, tiers, top-bottom-middle, groups, buckets, segments, bands, gradient-vs-discrete, color-by-group, color-encoding, marks, membership, categorical-color, performers
- Relevant user prompts/search terms: "color the bars into discrete groups not a gradient", "top and bottom profit performers colored by tier", "color a bar chart by a group instead of the measure value", "discrete color tiers top middle bottom", "how do I color marks by category not by value", "color by which group not by the number", "stop coloring by the measure gradient", "high medium low color bands", "color the winners and losers differently", "make the color a tier instead of a heatmap"

## When to Use

Reach for a discrete-group encoding the moment the ask names **categories of standing** rather than a smooth quantity:

- "the top performers and the bottom performers" → three groups (top / bottom / the rest)
- "high / medium / low", "above vs. below target", "winners and losers", "A/B/C tiers"
- any "show which of these N buckets each item falls into"

The tell is that the answer is a **label** ("Top"), not a **number**. If the reader's question is *"which group is this?"*, the encoding must answer with a distinct, unordered-looking color per group — not a position on a gradient they have to mentally threshold.

## Best Practices

1. **Build a bucketing calculated field first.** A dimension calc whose formula returns a small set of string labels (e.g. an `IF/ELSEIF` that assigns each row to a named group). Put THAT field on color. The groups are then discrete swatches a reader can name at a glance.
2. **Color encodes the group; position/size encodes the magnitude.** Let the bar length / axis carry the continuous value, and let color carry membership. They are different channels doing different jobs.
3. **Reserve gradients for genuinely continuous questions** — "how hot", "how dense", "how far from zero". A diverging red-white-blue gradient is correct for *"how profitable is each, on a continuum"*; it is the WRONG encoding for *"which of my three groups is this"*.
4. **If you must pin specific hues** (e.g. grey for a muted "everyone else" middle), assign per-member colors on the discrete field — don't switch back to a measure gradient to get the colors you want.

## Common Mistakes

1. **Coloring by the raw measure when the ask was about groups.** The single most common version: the request says "top/bottom/middle groups," and the build puts the measure (e.g. the value already on the bar's axis) on color, producing a continuous gradient. A gradient cannot say "this is the *bottom* group" — only "this is a slightly lower value." It silently answers a different question than the one asked.
2. **Coloring a mark by a value it already encodes positionally.** If the same field is on the axis (bar length, position) AND on color, the color is redundant — the bar already shows that value. This is the fingerprint of "reached for a gradient instead of designing the group encoding." Color should add a dimension the position doesn't.
3. **Treating "diverging looks nice" as the design.** Aesthetics of a palette ≠ the right encoding. Choose the encoding from the *question* (membership vs. magnitude), then pick a palette to fit it.
4. **Skipping the bucketing calc because sorting "kind of" shows the groups.** Sorting puts extremes at the ends, but it does not *label* membership; a reader still can't tell where "top" stops and "the middle" begins without the discrete encoding.

## Implementation

1. Author a dimension calculated field that buckets rows into the named groups (an `IF/ELSEIF/ELSE` returning string labels). Register it like any calc; reference it on a shelf as its discrete `none:` column-instance (a dimension calc on a shelf must be `none:` / `derivation="None"`, never `usr:` — see `expertise://tableau/tactics/data/calc-fields`).
2. Put that bucketing field on **Color** (`<color column="[ds].[none:<GroupCalc>:nk]"/>`). Keep the continuous measure on the axis/shelf where it conveys magnitude.
3. To pin specific hues per group, map members on the discrete field in the datasource `<style>` node (`<encoding attr="color" type="palette"><map to="#..."><bucket>...` — see `expertise://tableau/tactics/viz/marks-and-encodings` "Discrete-tier color").
4. Verify by opening the viz: the legend should read as a short list of named groups, not a continuous color ramp.

## Related Knowledge

- `expertise://tableau/tactics/viz/marks-and-encodings` — the discrete-tier color XML and the gradient-vs-discrete encoding forms.
- `expertise://tableau/tactics/data/calc-fields` — authoring the bucketing calc + the `none:` derivation rule.
- `expertise://tableau/strategy/viz-design/color-strategy` — palette selection once the encoding (discrete vs. continuous) is chosen.
- `expertise://tableau/strategy/viz-design/encoding-strategy` — the broader channel-selection strategy this is a specific case of.

## Source and Confidence

- Source/evidence type: design best-practice
- Source: BI visualization design principles — discrete membership encoding vs. continuous magnitude encoding
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-03
