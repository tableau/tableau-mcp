# Audience Budgets & Question Prioritization

Two quantitative scoping tools for the *start* of a dashboard request: a **time/complexity budget per audience** (hard guardrails on filter count, chart complexity, and glance time) and a **P1–P4 question-priority triage** (which questions earn which real estate). These convert the qualitative archetype decision into numeric constraints you can hold a design to — and into a rule for what goes on page one versus behind an interaction.

Tags: audience, time-budget, question-prioritization, scoping, filter-count, dashboard-design, triage

**Related strategy:** pick the *shape* first with `expertise://tableau/strategy/dashboard-design/dashboard-archetypes` (strategic / operational / analytical) — this file adds the *numbers* to that shape. When a dashboard exceeds its budget, `expertise://tableau/strategy/dashboard-design/dashboard-overload` is the split-and-defer remedy; `expertise://tableau/strategy/dashboard-design/dashboard-content-placement-strategy` covers where on the canvas the P1/P2 zones go.

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: create, refine, scope
- In-scope reason: At the start of a dashboard request, this gives the agent numeric guardrails (how many filters, how complex, how long to read) tied to the audience, and a triage for which questions belong on the first screen — so a dashboard is scoped to its reader instead of accreting every requested chart.
- Out-of-scope risk: none
- Tags: audience, time-budget, question-prioritization, scoping, filter-count, dashboard-design, triage, p1-p4, exec-dashboard, analyst-dashboard, progressive-disclosure
- Relevant user prompts/search terms: "how many filters is too many", "dashboard for executives", "how much detail for an analyst", "what goes on the first screen", "my dashboard has too many charts", "prioritize dashboard content", "which questions go on the dashboard", "exec vs analyst dashboard", "scope a dashboard", "time budget dashboard", "how complex should this dashboard be"

## When to Use

Use this at the *scoping* stage, right after you've picked the archetype and before you place a single chart:
- **A stakeholder hands you a long list of "can you also show…" requests** — triage them P1–P4 so page one stays focused.
- **You need to justify saying "not on this screen"** to a request that would blow the audience's budget.
- **Deciding how many filters/charts is defensible** for this reader.
- **A dashboard already feels crowded** and you need an objective basis to cut or defer.

This is the numeric layer on top of the archetype taxonomy — it does not replace it. Choose strategic vs. operational vs. analytical first (`dashboard-archetypes`); then apply the budget and triage below.

---

## Audience Time & Complexity Budgets

Each audience reads for a different length of time and tolerates a different complexity. Treat these as **guardrails, not laws** — but a design that violates its audience's budget needs an explicit reason.

| Audience | Glance/read budget | Max visible filters | Chart complexity | Interaction model | KPI priority |
|---|---|---|---|---|---|
| **Executive** | 5–30 sec | 0–2 | Low — BANs, trend, bullet | Scan; maybe one date/region filter | Critical — the headline *is* the dashboard |
| **Manager** | 30 sec–3 min | 2–4 | Medium — add ranking, breakdown | Light filtering + drill to detail | High — KPIs plus the "why" one level down |
| **Analyst / power user** | 3–15 min | 4–8 | High — scatter, heatmap, cohort, drill | Heavy — filters, parameters, set/param actions | Context — KPIs frame the exploration, aren't the point |
| **Operations** | continuous, act in seconds | 1–3 | Medium, ruthlessly prioritized to actionable | Alert + light triage drill | High — status, not history |
| **External / public** | 10–60 sec | 0–2 | Low, plain-language | Minimal, self-explanatory | High — one clear message |

**How to use the budget:**
- **Filters over budget → convert or defer.** More than the audience's max means either the wrong archetype (an analyst tool handed to an exec) or that some filters belong in a drill/detail view reached by a Navigation button, not on the main screen.
- **Complexity over budget → split or promote.** An exec dashboard that needs a cohort heatmap is really two dashboards: a strategic glance and an analytical companion.
- **Reading time is the sanity check.** If the design can't be *read* (not exhaustively explored) inside the budget, the hero metric isn't prominent enough — fix prominence before adding anything. Pairs with the 5-second test in `dashboard-archetypes`.

---

## Question Prioritization: the P1–P4 Triage

A dashboard rarely fails because a chart is wrong — it fails because *every* question got equal real estate. Rank each business question the dashboard is asked to answer, then place it by rank:

| Tier | The question is… | Placement |
|---|---|---|
| **P1** | Decision-critical — a viewer acts on it *every* time they open the dashboard | Page one, above the fold, top-left / hero position |
| **P2** | Monitoring — watched regularly, doesn't always trigger action | Page one, below the P1 zone |
| **P3** | Diagnostic — asked *only when* a P1/P2 reveals a problem ("why is this down?") | Page two, or behind a drill / Dynamic Zone Visibility / filter action |
| **P4** | Reference — occasional context, definitions, footnotes | Appendix page, tooltip, or a collapsible detail zone |

**The one rule that matters:** **never let P3/P4 crowd P1/P2 on page one.** Diagnostic and reference content is where progressive disclosure earns its keep — it appears *when summoned* by an interaction, not by default. The most common overload cause is a diagnostic breakdown (P3) sitting permanently next to the headline KPI (P1), so neither reads.

**How to run the triage:**
1. List every question the dashboard is asked to answer (from the request, not from the charts you imagined).
2. Tag each P1–P4 by the test above — *acted on every time* (P1) vs. *only when a problem shows* (P3).
3. Give P1 the hero position, stack P2 below it, and route P3/P4 behind an interaction or onto a second page.
4. If there are more than ~2–3 P1s, the dashboard is trying to answer too many decision-critical questions — that's a signal to split it, not to shrink the charts.

---

## Implementation

1. **Pick the archetype** (`dashboard-archetypes`) — strategic / operational / analytical — which sets the audience.
2. **Look up the audience budget** and treat its filter/complexity/time numbers as the design's guardrails.
3. **Triage the questions P1–P4** against the actual request; assign each a zone by rank.
4. **Lay out P1 hero, P2 below, P3/P4 deferred** — progressive disclosure via Navigation button, Dynamic Zone Visibility, or a second page for anything P3+.
5. **Check the design back against the budget** — count visible filters, estimate read time, confirm complexity fits. Over budget → convert filters to drill, split the dashboard, or promote the analytical part to its own surface.
6. **Verify with the 5-second test** — show it briefly and confirm the viewer recalls the P1 answer, not a P3 detail.

### Confirmed example

Request: an executive sales dashboard, but stakeholders also asked for a rep-level activity breakdown, a data-dictionary, and a churn-driver analysis.

- **Archetype:** strategic → **Executive budget:** 0–2 filters, low complexity, 5–30 sec read.
- **Triage:** "Are we on track to target?" = **P1** (hero KPI strip + trend). "How are regions tracking?" = **P2** (a bar below). "Why is West down?" (churn drivers) = **P3** — *not* on page one; behind a Navigation button to an analytical companion. Rep-level activity = **P3** (drill). Data-dictionary = **P4** (tooltip / appendix).
- **Result:** page one holds one date filter, a KPI strip (P1), and a regional bar (P2) — inside budget. The churn/rep/dictionary content, which would have blown both the filter count and the read-time budget, is deferred. The exec gets a 10-second glance; the analyst who needs "why" clicks through.

**What does NOT work:**
- **Putting the P3 diagnostic next to the P1 KPI "so it's all in one place"** — it crowds the headline and blows the exec's read-time budget; defer it behind an interaction.
- **Exposing 6 filters on an exec dashboard** — over the 0–2 budget; it signals the wrong archetype or that filtering belongs in a drill view.
- **Treating the budget as a hard cap with no exceptions** — a manager dashboard can justify a 5th filter *with a reason*; the budget forces the justification, it doesn't forbid the filter.
- **Triaging by chart instead of by question** — rank the *questions* the dashboard answers, then let that decide the charts; ranking charts you already drew just rationalizes the crowding.

## Best Practices

- **Archetype first, then numbers.** The budget only makes sense once you know who reads it; pick the shape, then hold it to the audience's filter/complexity/time guardrails.
- **Rank questions, not charts.** P1–P4 is a triage of the *questions*; the charts follow from the ranking.
- **P3/P4 is progressive-disclosure territory.** Diagnostic and reference content appears when summoned, never crowds page one.
- **Use the budget to justify "no."** A filter count or complexity level over budget is the objective basis for deferring or splitting — it turns a taste argument into a scoping rule.
- **More than 2–3 P1s means split, not shrink.** Too many decision-critical questions is a signal for a second dashboard, not smaller charts.

## Common Mistakes

1. **Equal real estate for every question** — the root cause of overload; P3/P4 sitting permanently beside P1/P2.
2. **Over-budget filters** — handing an exec an analyst's 6-filter control panel.
3. **Ranking charts instead of questions** — rationalizing the charts you already built rather than triaging what the dashboard must answer.
4. **Ignoring the read-time budget** — a "glance" dashboard that takes two minutes to parse because the hero metric isn't prominent.
5. **Treating budgets as absolute** — the numbers are guardrails that *force a justification*, not hard prohibitions; a defended exception is fine, an undefended overage is not.

## Source and Confidence

- Source/evidence type: community-adapted best practice
- Source: Audience time/complexity budgets and the P1–P4 question-prioritization triage adapted from `adammico-lab/Tableau-Dashboard-Blueprint-BETA` (Adam Mico, Apache 2.0), curated to house format and de-branded. Deliberately scoped to the two frameworks the existing `dashboard-archetypes` module lacks (quantified guardrails; question triage); the source's chart-selection, color, and container guidance was excluded as already covered.
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-13
