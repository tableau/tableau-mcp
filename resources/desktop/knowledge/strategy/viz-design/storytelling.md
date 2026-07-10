# Storytelling with Data: Narrative & Decision-Driving

How a viz stops being decoration and starts driving a decision: lead with the answer, structure the argument, title for the takeaway, tie every view to an action.

The communication layer above chart choice and design — what to say, and how to frame it.

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: refine, create
- In-scope reason: Decides *what to say and how to frame it* before chart choice — action titles, BLUF/Pyramid structure, annotation-as-narrative, the "so what?" test. This is what makes Athena a consultant that drives a decision, not a chart vendor.
- Out-of-scope risk: none (Pulse/alerts noted as Cloud "where this leads," not Desktop steps)
- Tags: storytelling, narrative, action-titles, BLUF, pyramid-principle, annotation, knaflic, cairo, shneiderman, decision-driving, communication
- Relevant user prompts/search terms: "how do I make this dashboard tell a story", "what should the title say", "lead with the conclusion", "action title vs topic title", "how do I make the point clear", "annotate the key insight", "structure a data presentation", "make the viewer act"

## When to Use

Use this when the goal is communication/persuasion, not just display — when a user wants the dashboard to make a point, drive a decision, or "tell a story," or asks what the title/annotations should say. It sits *above* chart choice. The exploratory-vs-explanatory decision and the 5-second test live in [Dashboard Archetypes](data/knowledge/strategy/dashboard-design/dashboard-archetypes.md); the perceptual *why* in [Visual Design Principles](data/knowledge/strategy/viz-design/design-principles.md); chart choice in [Chart Type Selection](data/knowledge/strategy/viz-design/chart-selection.md); builds in [Advanced Chart Build Recipes](data/knowledge/strategy/viz-design/advanced-chart-builds.md). Cross-ref those — don't re-derive them here.

> Schools of thought, not laws (Knaflic, Cairo, Minto). Strong defaults; name the context when you depart. The decisive test is whether the intended audience takes the intended action.

## Best Practices

### Lead with the answer — structure for a decision

- **BLUF (bottom line up front):** lead with the conclusion; don't make a busy decision-maker wait for the punchline. *In Tableau:* the dashboard **title is the BLUF** — "Recommendation: discontinue Product X (−$500K/yr)", not "Product Profitability." Top-left zone (or Story Point 1) = the answer; everything after is evidence.
- **Minto Pyramid:** answer on top → ~three **MECE** supporting points (mutually exclusive, collectively exhaustive) → evidence beneath each (the rule of three respects working memory). *In Tableau:* top = a BAN stating the conclusion; middle = three views each proving one non-overlapping point; bottom = drill sheets via actions. In a Story: point 1 = answer, 2–4 = the supports, 5 = next steps.
- **Shneiderman's mantra:** "overview first, zoom and filter, then details-on-demand." *In Tableau:* overview = the KPI strip / summary; zoom & filter = filter/highlight/set actions + parameters; details-on-demand = viz-in-tooltip + navigation to a detail sheet.

### Title and annotate for the takeaway (the highest-leverage move)

- **Action/insight titles, not topic titles:** "West region drove 60% of Q3 growth" — not "Sales by Region." A dynamic (parameter-/calc-driven) title can restate the sentence as the user filters. *Caveat:* dynamic titles need a single-value field (parameter, FIXED LOD, or constant calc), and re-running Show Me clears title edits.
- **Direct labeling beats a legend** — removes the eye's round-trip. Label line endpoints with a `LAST()=0`-filtered Label (or Label ▸ Marks to Label ▸ Line Ends) instead of a color legend.
- **Reference lines/bands deliver context** — target, prior period, average, good/bad range (Analytics pane; how to add/read them is in [analytics-pane-reference](data/knowledge/tactics/viz/analytics-pane-reference.md)). A number means nothing without one.
- **Callouts spotlight the climax** — right-click a mark ▸ Annotate ▸ Mark; put the insight *and the implied action* in the text. (Annotations are static, Desktop-formatted; web authoring is limited.)

### Knaflic's narrative arc — and the "so what?" test

Setup → rising tension → **climax (the insight / "so what?")** → resolution (the action). **For every chart, ask "so what?" — if there's no answer, cut it.** *In Tableau:* Story Points as the arc (overview → problem → climax view → recommendation); annotate the climax mark with the takeaway. Two hard lines worth keeping (the *why* is owned by [design-principles](data/knowledge/strategy/viz-design/design-principles.md)): **no pie/donut** beyond a 2–3-slice "roughly half" read; **"be gone, dual y-axis"** — instead direct-label the second series, use two charts sharing the X-axis, or index both to % change.

### Cairo — truthfulness and tuning to the audience

The five qualities: **truthful** (first, non-negotiable), functional, beautiful, insightful, enlightening. The **visualization wheel** (six trade-off dials: abstraction↔figuration, functionality↔decoration, density↔lightness, …) is the antidote to dogma — there's no single right position; you tune to the audience (experts tolerate dense/abstract; the public wants light/familiar). The net-new communication move from Cairo: **show uncertainty and provenance** — a reference band / confidence interval, sample size in the tooltip, and the data source + as-of date in a Text object, so the audience can trust the claim. (The encoding-integrity rules — zero baseline on bars, no causation from a trend line — are owned by [design-principles](data/knowledge/strategy/viz-design/design-principles.md) and the Statistical Traps in [chart-selection](data/knowledge/strategy/viz-design/chart-selection.md); apply them, don't re-derive.)

### Fit the medium

| Medium | Build | Tableau |
|---|---|---|
| Live presentation | one idea per beat; you narrate | Story Points; large fonts; minimal on-slide text; Presentation mode |
| Emailed / static report | self-explanatory; no narrator | export to PDF; full annotations + action titles + source note; assume no interactivity |
| Self-service dashboard | interactive, discoverable | Quick Filters + obvious instructions; filter/highlight actions; viz-in-tooltip |
| Guided analytics (the sweet spot) | controlled path, still interactive | Story Points or nav buttons + Dynamic Zone Visibility to reveal the next layer on click |

## Common Mistakes

- **Topic title instead of an action title** — "Sales by Region" leaves the takeaway for the reader to find; state it.
- **Burying the conclusion** — making a decision-maker hunt for the answer instead of BLUF.
- **Keeping a chart that has no "so what?"** — if it doesn't support the Big Idea, it's clutter.
- **No narrative arc** — a pile of correct charts with no Big Idea, no lead answer, and no stated "so what?" (the exploratory-vs-explanatory decision that precedes this is owned by dashboard-archetypes).
- **A naked KPI** — status by a bare red/green dot, no target/context, not colorblind-safe.
- **Implying causation** from a scatter+trend without the caveat (Cairo's "suggesting patterns that aren't there").

## Implementation

Before building, answer Knaflic's context questions: who is the audience, what do you want them to know or do, and what's the **Big Idea** (one sentence)? Put that Big Idea in the title as a BLUF; structure the rest as a pyramid (answer → three MECE supports → evidence). Pick the chart for the message, declutter to one accent on the insight, annotate the climax with the takeaway and implied action, give every KPI context, keep it truthful (zero baseline, show uncertainty, cite source), and fit the medium. Then verify the only way that counts: show it to a representative viewer and confirm they reach the intended takeaway *and action* in seconds — if not, redesign, don't re-explain.

## Related Knowledge

- Sits above [Chart Type Selection](data/knowledge/strategy/viz-design/chart-selection.md) (which chart) and [Visual Design Principles](data/knowledge/strategy/viz-design/design-principles.md) (why an encoding reads) — this layer decides *what to say* before either.
- Defers the exploratory-vs-explanatory decision, the 5-second test, and the three archetypes to [Dashboard Archetypes](data/knowledge/strategy/dashboard-design/dashboard-archetypes.md) — referenced here, not restated.
- The slopegraph/BAN/bullet builds it recommends are in [Advanced Chart Build Recipes](data/knowledge/strategy/viz-design/advanced-chart-builds.md); the truthfulness checks pair with the Statistical Traps in chart-selection.

## Source and Confidence

- Source/evidence type: external reference (adapted with permission)
- Source: adapted from `plugin-tableau-master` (`references/storytelling-with-data.md`) by Jon Plax, used with the author's permission; underlying frameworks are Knaflic (*Storytelling with Data*), Cairo (*The Functional Art* / *The Truthful Art* / *How Charts Lie*), the Minto Pyramid / BLUF tradition, and Shneiderman's mantra. Per the bot's guidance, NOT a full lift: the exploratory-vs-explanatory split, the 5-second test, and the three-archetype model were left to `dashboard-archetypes.md` (which already owns them); this carries the net-new narrative/structure/titling layer.
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
