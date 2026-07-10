# Dashboard Archetypes & Build Blueprints

The strategy layer above dashboard mechanics: which kind of dashboard to build for a given purpose and audience, and how to compose a complex one end-to-end.

Sources are Stephen Few (*Information Dashboard Design*) for the purpose-driven taxonomy and Wexler/Shaffer/Cotgreave (*The Big Book of Dashboards*) for worked recipes.

## Scope Check

- Primary audience: Tableau user
- Authoring outcome improved: create, refine
- In-scope reason: Helps Claude decide which dashboard archetype fits the user's purpose/audience and compose it, so the dashboard matches how it will actually be used instead of defaulting to one shape for every request.
- Out-of-scope risk: none (Cloud/Server features — Pulse, Bridge, Data Alerts, Subscriptions — are noted only as "where this leads," not as Desktop authoring steps)
- Tags: dashboard-archetypes, strategic, operational, analytical, dashboard-design, build-blueprints, few, dashboard-mistakes, audience
- Relevant user prompts/search terms: "build an executive dashboard", "KPI dashboard", "what kind of dashboard should I build", "operational monitoring dashboard", "what-if scenario dashboard", "cohort retention dashboard", "funnel dashboard", "dashboard for executives vs analysts", "my dashboard is too cluttered", "dashboard design mistakes"

## When to Use

Use this guide at the *start* of a dashboard request, before choosing charts or layout — when you need to decide whether the user needs a calm executive glance, a real-time operational monitor, or a dense analytical explorer, and how to compose it. Choosing the wrong archetype (burying an exec's glance under an analyst's drill controls) is the root of most bad dashboards. For layout/container/sizing mechanics see [Dashboard Sizing, Containers & Layout Examples](data/knowledge/tactics/dashboard/dashboard-layout-structure.md) and [Dashboard zones (tactical XML)](data/knowledge/tactics/dashboard/zones.md); for performance tuning see [Dashboard Performance & Efficient Workbooks](data/knowledge/tactics/data/dashboard-performance-efficient-workbooks.md).

## Best Practices

### The three archetypes — a purpose-driven taxonomy

A dashboard's **purpose** dictates almost every design decision. Few names three roles; conflating them is the most common failure.

| | **Strategic** | **Operational** | **Analytical / Exploratory** |
|---|---|---|---|
| **Who reads it** | Executives, directors — steer, don't operate | Front-line ops, support, dispatch — act *now* | Analysts, power users — investigate |
| **Question** | "Are we on track against our goals?" | "Is anything wrong right now, and what do I do?" | "Why did this happen? What if we changed X?" |
| **Cadence** | Periodic (monthly/quarterly), reviewed in a meeting | Real-time, watched continuously | On-demand, opened for one ad-hoc question |
| **Density** | Low — a few high-level KPIs with context | Moderate, ruthlessly prioritized to what's actionable | High — many marks, fine granularity |
| **Interaction** | Minimal — glance, maybe one filter | Alerting + light triage drill | Rich — filters, parameters, set/parameter actions, drill |
| **Chart vocabulary** | BANs + sparklines, bullet graphs (actual-vs-target), trend lines | Real-time line/area, Top-N offenders, status map, Pareto | Scatter, heatmap, cohort matrix, funnel, box plot, drill bar/line |

**Strategic** (executive/KPI monitoring): maximize signal, minimize ink. One screen, no scroll. A KPI strip of BANs with context (prior period, target, trend) — never a naked number. Calm palette, gray default + one accent for the metric that's off-track. Interaction intentionally thin; drilling belongs in an analytical companion reached by a Navigation button. *(For execs who rarely open Tableau, the modern equivalent is often **Tableau Pulse** — a Cloud-governed metrics layer that pushes insights by email/Slack. Pulse is a Cloud feature, out of scope for Desktop authoring; flag it as an alternative, don't build it here.)*

**Operational** (monitoring/alerting/action): make *what needs attention* unmissable and *what to do* obvious. Status, not history — Top-N offenders, a live trend, a map of where the problem is. Color reserved for status, never color-alone (pair with shape/label). *(Freshness mechanics — live connections, Tableau Bridge, Data Alerts, Subscriptions — are Cloud/Server features; the Desktop authoring job is the design: prioritized status views, relative-date framing, a triage filter action from an alarm row to the detail.)*

**Analytical/exploratory** (drill/comparison/what-if): density is a feature. Many marks, fine granularity, side-by-side comparison — the one type where scroll, tabs, and drill are legitimate. Decide first whether you're shipping an *exploratory* surface (all controls exposed) or an *explanatory* guided path (most controls hidden, one story) — most failed analytical dashboards are exploratory artifacts shipped as if explanatory. Drill toolbox: parameter actions + Dynamic Zone Visibility, set actions for select-to-compare, Viz in Tooltip. What-if is the signature move: a parameter drives a calc and the user dials a scenario live. Watch the mark budget (>1000 marks can force server-side rendering — slow and bad for accessibility).

**Hybrids are the real world.** Almost every production dashboard mixes types: a strategic KPI strip on top (glance) over operational/analytical detail below (act/investigate), with progressive disclosure so complexity only appears when summoned. Name which archetype *each zone* serves and design that zone's density and interaction to its role.

### Few's 13 dashboard mistakes → the Tableau fix

| # | Mistake | Tableau fix |
|---|---|---|
| 1 | Exceeding a single screen | Fixed-size dashboard sized to the display; cut to 2–3 views; push detail behind DZV/Show-Hide/Navigation rather than scroll |
| 2 | Inadequate context for the data | Reference Lines/Bands for target/prior/average; YoY % delta beside a BAN; pair KPIs with bullet graphs |
| 3 | Excessive detail or precision | Format ▸ Numbers → fewer decimals; abbreviate K/M/B; round in a calc |
| 4 | A deficient measure | Choose the measure tied to the objective; state its unit; prefer a rate over a raw count where meaningful |
| 5 | Inappropriate display media | Override Show Me's pie/gauge; time→line, ranking→sorted bar, part-to-whole→bar, actual-vs-target→bullet |
| 6 | Meaningless variety | Reuse one chart type for like data; consistent palette + mark type (Gestalt similarity) |
| 7 | Poorly designed display media | Label marks directly; sort logically; use color sparingly; never 3-D |
| 8 | Encoding quantitative data inaccurately | Bars must include zero (don't uncheck "Include zero"); lines may use a non-zero baseline *if labeled* |
| 9 | Arranging the data poorly | Most important view upper-left; align comparisons with synchronized axes; nest containers for a clear grid |
| 10 | Highlighting important data ineffectively | Gray default + one accent via a boolean color calc; Highlight Actions; bolder text on the key BAN |
| 11 | Cluttering with useless decoration | Format ▸ Lines/Borders/Shading = None/pale; remove logos/3-D/gradients that don't encode data |
| 12 | Misusing or overusing color | Gray default; one accent hue for attention; sequential for ordered, categorical (≤~7 hues) for nominal; never color-alone |
| 13 | An unattractive visual display | Consistent alignment/padding, restrained palette, quiet background, generous white space |

### Six build blueprints

Each gives the question, archetype, sheet inventory, layout, and interactivity. Chart construction (BAN, bullet, sparkline, Pareto, funnel) is the viz-building layer; this is the composition.

**(a) Executive KPI / BAN summary** — *strategic.* "Are we hitting our top-line goals, and where are we off-track?" 4–6 BAN tiles (big number + YoY % delta + ▲/▼ colored by direction), a sparkline beside each, one bullet graph per KPI (actual-vs-target, two qualitative bands). Layout: top Horizontal container = KPI strip (Distribute Evenly); Horizontal row of bullets below; footer Text (source + as-of date). Fixed size. Interaction: one date/region filter + a Navigation button to the analytical companion. Gray default, one accent on the off-track metric (`[Actual]<[Target]`).

**(b) Sales/revenue operational monitor** — *operational (often hybrid).* "How is the pipeline tracking, who are the top/bottom performers, where is revenue concentrated?" KPI strip; a Top-N sorted bar (driven by an N parameter); a Pareto chart (cumulative % to find the 80/20); a region map; a detail crosstab. Layout: Vertical root → [KPI strip] → [Top-N + Pareto] → [Map + detail]. Interaction: Filter Action from the map to the Top-N and detail ("Use as Filter"); N parameter control. Pareto needs a Running Total + Percent of Total table calc with Compute Using set explicitly — the #1 Pareto failure mode.

**(c) Cohort / retention explorer** — *analytical.* "Which cohorts retain, how does retention decay, which segment drives it?" A cohort heatmap (cohort month on Rows, months-since-signup on Columns, retention % as color); a retention-curve line; a segment bar; a drill panel revealed on demand. Interaction: parameter action + DZV to reveal the drill zone on cell click; set action to select-to-compare two cohorts; Viz in Tooltip for segment mix. Cohort math (months-since-signup, retained-%) is an LOD/table-calc problem — see the [LOD & Table-Calc Pattern Cookbook](data/knowledge/tactics/data/lod-and-table-calc-patterns.md).

**(d) Funnel / conversion** — *analytical, presented explanatory.* "Where are we losing users, and how does drop-off differ by channel?" A centered funnel (stage on Rows, count as length, symmetry from a `-[Measure]` field + Area marks — not a built-in funnel type); a stage-to-stage conversion-rate bar; a channel small-multiple; BANs for top-of-funnel volume and overall conversion %. Label each stage with absolute count *and* step conversion % (context, mistake #2). Order stages logically top-to-bottom.

**(e) Geospatial operational** — *operational.* "Where are incidents/outages/deliveries, and which sites need attention?" A status map (symbol or filled, colored by status + shape/label, never color-alone); a Top-N "worst sites" list; a live incident-volume trend; a selected-site detail table. Layout: map dominates (~60% left); right Vertical = worst-sites + trend + detail. Interaction: Filter Action from a map mark to the detail; Highlight Action to keep the site lit; `tel:`/`sms:` URL Actions for field staff on mobile.

**(f) What-if scenario** — *analytical (what-if).* "If we change price/growth/headcount by X, what happens to revenue/margin/runway?" A driver line/area chart (projection under the scenario); a sensitivity bar/tornado; scenario-output BANs on top so the headline answer is always visible. The core is **parameters**, not Actions: one parameter per driver (Allowable values = Range or List), referenced in a calculated field that recomputes the projection. State the scenario assumptions in a Text object (mistake #2) and show a baseline reference line so the delta from "do nothing" is visible.

### The 5-second test

Show the dashboard to a representative viewer for ~5 seconds, take it away, and ask what they remember and where their eyes went first. If the hero metric isn't what they recall, fix prominence (size, position top-left, the lone accent) before adding anything. The audience, not the author, judges whether it reads.

## Common Mistakes

- Building one dashboard shape for every request — a dense analyst drill handed to an executive who needs a glance, or a calm KPI board handed to ops who need live alerting.
- Shipping an exploratory surface (every control exposed) when the audience needed an explanatory, guided one.
- Treating Cloud/Server features (Pulse, Bridge, Data Alerts, Subscriptions) as Desktop authoring steps — they're where an operational/strategic design *leads*, not something authored in Desktop.
- Naked KPIs with no target/prior/benchmark context (Few's mistake #2 — the most common).
- Ignoring the mark budget on analytical dashboards (>1000 marks forces server-side rendering — slow, non-accessible).

## Implementation

Start by naming the purpose and audience, then pick the archetype (or, for a hybrid, name the archetype each *zone* serves). Match density and interaction to that role: strategic stays at one screen with minimal interaction; operational prioritizes actionable status; analytical earns its density but should decide exploratory-vs-explanatory up front. Pick the closest build blueprint as a starting skeleton, compose it with tiled containers (hero view upper-left), then run the 13-mistakes list and the 5-second test before shipping. Verify the result in Tableau for readability and that the intended audience reaches the true conclusion.

## Related Knowledge

- Extends [Dashboard Layout & Design Strategy](data/knowledge/strategy/dashboard-design/dashboard-layout-patterns.md) and [Dashboard Sizing, Containers & Layout Examples](data/knowledge/tactics/dashboard/dashboard-layout-structure.md): those cover layout/container/sizing mechanics; this entry sits above them at the purpose/archetype level.
- Complements [Operational and Pipeline Dashboard Pattern](data/knowledge/strategy/dashboard-design/operational-pipeline-dashboard-pattern.md): that is one worked operational pattern (task queue); this generalizes the operational archetype and adds five more blueprints.
- Pairs with [Dashboard Overload](data/knowledge/strategy/dashboard-design/dashboard-overload.md): when a user asks for too much on one dashboard, the archetype taxonomy explains *why* (operational density on a strategic glance) and what to split out.
- The Pareto/cohort blueprints reference the [LOD & Table-Calc Pattern Cookbook](data/knowledge/tactics/data/lod-and-table-calc-patterns.md).

## Source and Confidence

- Source/evidence type: external reference (adapted with permission)
- Source: adapted from `plugin-tableau-master` (`references/dashboard-archetypes.md`) by Jon Plax, used with the author's permission; underlying frameworks are Stephen Few (*Information Dashboard Design*) and Wexler/Shaffer/Cotgreave (*The Big Book of Dashboards*)
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
