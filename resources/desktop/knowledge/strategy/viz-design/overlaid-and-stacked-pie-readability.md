# Overlaid & Stacked Pie Charts — Push Back, Then Offer a Readable Alternative

"Overlay multiple pie charts" and "stack / nest two pie charts" ask for a build Tableau *can* produce (dual-axis pies) but that is one of the weakest ways to show the data. People compare angles poorly to begin with; layering pies compounds it — overlapping slices occlude one another and a small inner pie is unreadable. The correct response is neither a silent build nor a flat refusal: **name the readability cost in one sentence, then offer the alternative that answers the same question** (usually a sorted or 100% stacked bar, small multiples, a treemap, or a dual-axis whose second mark is a bar/line — not a pie). Build the overlaid/nested pie only if the user still wants it after hearing the tradeoff, and then cap it.

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: refine, create, validate
- In-scope reason: Turns a "make my pies overlap / stack" request into a design-quality pushback-and-redirect — states why layered pies read poorly, maps the underlying intent (compare groups / show hierarchy / two measures) to the more legible chart, and gives the honest "if you insist" build so the guidance is a redirect, not a refusal.
- Out-of-scope risk: none
- Tags: pie-chart, overlaid-pies, stacked-pie, nested-pie, donut, part-to-whole, chart-readability, pushback, small-multiples, hundred-percent-stacked-bar, treemap, dual-axis-pie, angle-comparison, chart-selection
- Relevant user prompts/search terms: "overlaying multiple pie charts", "overlay multiple pie charts", "stacking 2 pie charts", "stack two pie charts", "nested pie chart", "pie chart within a pie chart", "compare multiple pie charts on one view", "layer pie charts on top of each other", "make my pies overlap", "switch inner and outer ring of a stacked pie", "is it a good idea to stack pie charts", "better chart than overlapping pies"

## When to Use

Reach for this when a request implies **pie-on-pie** comparison:

- "Overlay / superimpose multiple pie charts."
- "Stack / nest two pies" (inner + outer ring), or "swap the inner and outer ring."
- "Compare these pie charts" where the plan is to layer them.

It is the *chart-choice pushback* for that specific request. For general chart selection see the chart-selection companion; for the actual dual-axis pie/donut build mechanics (once the tradeoff is accepted) see the advanced-chart-builds companion.

## Best Practices

1. **Lead with the tradeoff, not a refusal.** Pies are already low-precision (angle comparison); overlaying or nesting multiplies the cost (occlusion, invisible small slices, false alignment). Say so in a sentence and immediately offer the more legible option — this is "yes, and here's the way it will actually read," not "no."
2. **Map the intent to the alternative:**
   - *Compare the same categories across a few groups* → **small multiples** (one small pie per group) or, more precisely, a **grouped / 100% stacked bar**; a sorted horizontal bar per group is the safest read.
   - *Two levels (inner = parent, outer = child)* → a **stacked / segmented bar** or a **treemap** shows the hierarchy far more precisely than nested rings.
   - *Two measures (e.g. actual vs target as two rings)* → a **bullet / bar-in-bar**, or a **dual-axis where the second mark is a bar or line**, not a pie.
3. **If they proceed anyway, cap the complexity.** Limit to **≤ 5 slices** per pie, turn **value labels on**, and never use **3D / exploded** pies (perspective distorts proportion). Nesting beyond two levels makes inner rings unreadable.
4. **Build honestly, and reuse the recipe.** The legitimate mechanic for overlaid/donut pies is **dual-axis pies** — a `MIN(1)` placeholder axis duplicated, the top pie recolored to the background and shrunk via Size to punch a hole; total on Label. Cross-link that build rather than reinventing it.
5. **Watch the dual-axis false-comparison trap.** Two pies overlaid on axes whose slices aren't on a shared scale invite a comparison the encoding can't support — the same way a dual-axis line/bar can suggest a false correlation.

## Common Mistakes

1. **Silently building the overlaid/nested pie** without flagging readability — the core anti-pattern this entry exists to stop.
2. **Flat-refusing** ("pies are bad") without offering the alternative that answers the question — unhelpful and not what the user needs.
3. **Nesting > 2 levels or > 5 slices per ring** — inner rings and small slices become invisible.
4. **Comparing overlaid pie angles across groups** where a 100% stacked bar or small multiples would be read accurately and instantly.
5. **3D / exploded pies** — perspective distortion makes the proportions lie.
6. **Treating a stacked / nested pie as a precise part-to-whole read** — it is an impression, not a measurement.

## Implementation

1. Restate the underlying question: comparing groups, showing a two-level hierarchy, or plotting two measures?
2. Name the pie-overlay readability cost in one line.
3. Recommend the matching alternative — sorted / 100% stacked bar, small multiples, treemap (hierarchy), or bullet / dual-axis-with-a-bar (two measures).
4. If the user still wants layered pies, cap to ≤ 5 labeled slices, no 3D, ≤ 2 rings, and build via the dual-axis pie recipe in the advanced-chart-builds companion.
5. Verify decisively: show it to a representative viewer and confirm they can actually read the comparison the pies were meant to convey — if not, fall back to the bar alternative.

## Related Knowledge

- `expertise://tableau/strategy/viz-design/chart-selection` — pie when-(not)-to-use, stacked-bar segment limits, treemap for many categories, and the dual-axis false-correlation caveat.
- `expertise://tableau/strategy/viz-design/chart-best-practices` — the "too many pie slices," "no 3D," and mark-class-priority (bar over pie) rules.
- `expertise://tableau/strategy/viz-design/advanced-chart-builds` — the dual-axis pie / donut build mechanic (`MIN(1)` placeholder axis, Size to punch the hole) for when the overlay is genuinely wanted.
- `expertise://tableau/strategy/viz-design/design-principles` — the perceptual "why bars beat pies" and secondary-encoding reasoning.
- `expertise://tableau/strategy/dashboard-design/dashboard-overload` — when several pies are really a symptom of an overloaded, too-many-parts view.

## Source and Confidence

- Source/evidence type: internal-doc synthesis
- Source: consolidated from this repo's chart-selection, chart-best-practices, and advanced-chart-builds expertise modules (pie limitations, part-to-whole alternatives, dual-axis pie mechanic); angle-comparison and part-to-whole readability are standard data-visualization best practice
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-07-06
