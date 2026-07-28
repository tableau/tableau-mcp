// The canonical, server-side source of truth for DESIGNING a Tableau data app — the "what to show
// and why" layer that sits above the build/publish mechanics. Served as the MCP resource
// `skill://tableau/design-data-app` (see designDataAppResource.ts). The build workflow
// (`skill://tableau/build-data-app`) owns *how* the app is wired, validated, and published; this
// skill owns *what* the app should communicate and how to make it truthful and readable.
//
// Distilled and adapted (with permission) from field design references by Jon Plax and prior Tableau
// authoring knowledge, grounded in Cleveland & McGill, Bertin, Tufte, Few, Knaflic, Cairo, Gestalt,
// color science (ColorBrewer/viridis), and Lisa Charlotte Muth's color guide. The original guidance
// targeted native Tableau Desktop authoring (Marks card, Show Me, Analytics pane, Story Points,
// containers); here every recommendation is re-expressed for a data app that is a **custom HTML / JS
// / CSS web app** you render yourself — you draw the marks, you own the palette, you write the title.
export const tableauDataAppDesignSkill = `# Design a compelling, trustworthy Tableau data app

## What this is

The design layer for a Tableau **data app** — a custom HTML/JS/CSS web app, bundled as a viz
(worksheet) extension, that queries a published datasource **live**. This skill decides *what to
show, how to frame it, and why one encoding reads more truthfully than another*. The companion build
skill (\`skill://tableau/build-data-app\`) owns the mechanics: scaffold → author → validate →
publish → review.

**You render everything yourself.** There is no Marks card, no Show Me, no Analytics pane, no
drag-to-Rows. When this skill says "put the measure on position" or "grey the non-focal marks," that
is an instruction about the SVG/Canvas/DOM you write and the CSS you apply — not a Tableau UI action.
Treat these as strong, well-argued defaults ("schools of thought, not commandments"): name the
context when you depart, and remember the only decisive test is whether the intended viewer reaches
the intended conclusion.

## Start with the message, not the chart

Decide *what to say* before you decide how to draw it.

- **Lead with the answer (BLUF).** The app's headline (\`<h1>\`/header) is the bottom line, stated as
  a sentence: "Recommendation: discontinue Product X (−$500K/yr)", not a topic like "Product
  Profitability." Don't make a decision-maker hunt for the punchline.
- **Structure like a pyramid.** Answer on top → about three **MECE** supporting points (mutually
  exclusive, collectively exhaustive; the rule of three respects working memory) → detail beneath
  each. In a multi-panel app: a hero number/statement at the top, then a small number of panels that
  each prove one non-overlapping point, with drill/detail available on demand.
- **Overview first, then zoom/filter, then details on demand** (Shneiderman). Open on the summary;
  let the viewer narrow; reveal row-level detail last (hover, expand, a detail panel).
- **Apply the "so what?" test to every panel.** If a view has no answer to "so what should I do
  with this?", cut it. A pile of correct charts with no Big Idea is clutter.

## Choose the app's role (archetype)

A data app's **purpose** drives its density and interactivity. Name the role before composing; most
bad apps come from handing one shape to the wrong audience.

| Role | Reader & question | Density | Interactivity |
|---|---|---|---|
| **Strategic** | Executives — "Are we on track against goals?" | Low: a few KPIs *with context* | Minimal — glance, maybe one filter |
| **Operational** | Front-line ops — "Is anything wrong now, and what do I do?" | Moderate, ruthlessly prioritized to the actionable | Alerting + light triage drill |
| **Analytical** | Analysts — "Why did this happen? What if we change X?" | High: many marks, fine granularity | Rich — filters, parameters, select-to-compare, drill |

**Hybrids are the norm.** A strategic KPI strip on top (glance) over operational/analytical panels
below (act/investigate), with progressive disclosure so complexity appears only when summoned. Name
which role *each panel* serves and design that panel's density and interaction to its role. A single
app can be as robust and interactive as the designer wants — build multiple coordinated panels,
tabs, filters, and drill-downs in your own HTML/JS when the role calls for it.

**Compose it like a real dashboard.** Hero view upper-left; align comparable panels on shared scales;
group related panels with whitespace/padding (proximity), not heavy borders; keep one consistent
mark type and palette for like data (similarity). Use a CSS grid / flex layout for small multiples
and coordinated panels; reveal drill panels on click rather than showing everything at once.

## Encode by the judgment the viewer must make

The perception hierarchy (Cleveland & McGill; broadly replicated) ranks how *accurately* people
decode encodings, most → least accurate:

1. **Position along a common scale** (aligned bars, dot plots)
2. **Position along non-aligned identical scales** (small multiples)
3. **Length, direction, angle** (unaligned bars; pie slice angles)
4. **Area** (bubbles, treemaps)
5. **Volume, curvature** (3-D)
6. **Color saturation / shading** — least accurate

**So:** for any value the viewer must read *precisely*, use **position** — map the key measure to an
x/y axis in your chart. Use **color and size only for secondary, low-precision** encoding (category
hue, rough magnitude). A shared axis beats a dual axis (the second axis manufactures crossings).
Avoid 3-D entirely. **Caveat:** for "spot the cluster/outlier/shape" (not precise readout) a dense
scatter or heatmap can beat a long bar list — match the encoding to the question.

**Mark choice, in priority order** when several would work:

1. **Bar** — comparison, ranking, composition, distribution. When uncertain, a *sorted* horizontal
   bar chart is the safest default.
2. **Line** — trends over a continuous (usually time) axis.
3. **Scatter (circle)** — relationship between two measures.
4. **Text/number** — exact value lookup for small data (a big KPI number).
5. **Heatmap (square)** — dense matrix patterns.
6. **Area** — only when volume emphasis adds meaning; stacked for part-to-whole.
7. **Pie** — rarely best; use a bar. Acceptable only for a 2–3-slice "roughly half" read.

**Common encoding mistakes to avoid:** lines on categorical (unordered) data (implies false
continuity); unsorted bars (make the viewer scan); >7 color categories (indistinguishable — group
into "Other"); non-stacked areas with 3+ series (occlusion); filled maps when a bar answers more
precisely (area dominates perception); fine distinctions encoded by bubble size (Weber's law — a
~10% size change is the just-noticeable difference).

## Don't lie: graphical integrity

- **Zero baseline on bars.** Bar length encodes from a common baseline; a truncated axis inflates the
  ratio and lies. Keep zero when you draw bars. Lines encode by position, so a non-zero baseline can
  be legitimate *if labeled*.
- **No deceptive dual axis.** Two unrelated measures on independent scales can be made to "cross"
  anywhere. Prefer a shared/blended axis or index both series to % change; if you must dual,
  synchronize and label.
- **Rough-only for area/size.** Doubling a value doubles a bubble's *area* but radius grows as √, so
  viewers over-read big bubbles.
- **Show provenance and uncertainty.** Because the app queries **live**, surface the datasource name
  and an "as of <load time>" note in the app chrome; where relevant, show a reference band /
  confidence range and sample size. A number with no target/prior/benchmark is meaningless.
- **Don't imply causation** from a scatter + trend line without the caveat.

## Title and annotate for the takeaway (highest-leverage move)

- **Action/insight titles, not topic titles.** "West region drove 60% of Q3 growth" — not "Sales by
  Region." Restate the sentence dynamically as the viewer filters if you can.
- **Direct labels beat a legend.** Put the category name next to its mark (e.g. at a line's end) to
  remove the eye's round-trip.
- **Reference lines/bands deliver context** — target, prior period, average, good/bad range. Draw
  them in your chart.
- **Callouts spotlight the climax.** Annotate the one mark that carries the insight with the insight
  *and the implied action* — not just a value.

## Color

Get the palette *type* right first — it's the most common color mistake.

- **Continuous data → sequential or diverging gradient.** Sequential (light → dark) for one
  direction; diverging (e.g. blue ↔ orange through a neutral midpoint) for two directions from a
  meaningful center (pin the midpoint to the real center, e.g. zero for profit — not the data
  average). Steps must be visibly distinct; use ~5–7 steps, not a subtle 9-step ramp.
- **Categorical data → distinct hues**, ≤ 5–7 of them. Beyond that, the legend *becomes* the chart —
  group small categories into "Other."
- **Grey is the most important color.** Default most marks to a medium grey (\`#999\`/\`#aaa\`) and
  spend **one accent hue** on the mark that carries the insight. One blue bar among eleven grey ones
  communicates the ranking instantly; twelve different colors communicate nothing. This is pre-
  attentive pop-out — use *one* attribute (color) so the key mark is found in <250ms; a conjunction
  (red *and* square) forces slow serial search.
- **Never use hue for ordered data** (hue has no natural order) — use a sequential lightness ramp.
- **Accessibility outranks minimalism.** ~8% of men have red-green color-vision deficiency. Never
  encode meaning by red-vs-green alone — add a label, icon, or position cue. Prefer ColorBrewer
  palettes (colorblind-tested, print-safe); ship a hardcoded palette in the app rather than a
  rainbow default.
- **Text contrast.** WCAG AA is 4.5:1 (normal) / 3:1 (large). Dark fills need light labels and vice
  versa; make annotation text one shade darker than its mark color so it stays legible.
- **Keep legends close, or skip them.** Prefer direct labels; when a legend is needed, place it
  adjacent to the chart it serves. Color only the *category noun* in an annotation, not the whole
  sentence. A 2–4-category chart can use its title as the legend (color the category words to match
  the marks).

## Declutter — within reason

Maximize the share of ink that carries data: cut chartjunk (decoration that dominates data),
heavy gridlines, borders, and gradients that don't encode anything; direct-label instead of a distant
legend. **But** minimalism is not settled dogma — faint gridlines aid value lookup, controlled
embellishment can aid *retention* (not just comprehension), and accessibility always wins over a
lower ink count. Interactivity lets you keep the overview clean and put detail on demand.

## Verify — the only test that counts

You **cannot** see the app render against live data while authoring — a live query only runs inside
the Tableau host. So the design review is deferred to the build workflow's review loop: **publish the
app to the user's personal space, open it in Tableau, and look at it running against live data.**
Then apply the classic checks there:

- **The 5-second test:** glance for ~5 seconds, look away, and name what you remember and where your
  eyes went first. If the hero metric isn't what's recalled, fix prominence (size, top-left position,
  the lone accent) before adding anything.
- **The takeaway test:** confirm a representative viewer reaches the intended conclusion *and action*
  in seconds. If not, redesign — don't re-explain.

If it doesn't read, iterate the workspace files and republish (see the build skill). The audience,
not the author, judges whether it works.

## Source

Design rationale adapted with permission from \`plugin-tableau-master\` references by Jon Plax, and
from prior Tableau authoring knowledge; underlying frameworks are Cleveland & McGill, Bertin, Tufte,
Few, Knaflic (*Storytelling with Data*), Cairo (*The Truthful Art* / *How Charts Lie*), the Minto
Pyramid, Shneiderman's mantra, Gestalt, and Lisa Charlotte Muth's color guide (Datawrapper). All
native-Desktop authoring mechanics have been re-expressed for a custom-rendered web data app.
`;
