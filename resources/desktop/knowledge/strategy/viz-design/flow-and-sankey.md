# Flow Diagrams & Sankey — Be Honest About the Scaffold, Then Propose the Faithful Alternative

A multi-step, proportional **Sankey** ("show how budget flows from source to destination", "flow diagram between stages") is a build Tableau *can* produce, but not as a field swap onto the user's data. A faithful Sankey needs a **reshaped/densified scaffold data source** (a per-flow `t`-bin plus a sigmoid curve calc), which is the source of truth — so it cannot be one-shot reliably, and **cycles in the flows render incorrectly**. The correct response is neither a silent (and likely wrong) densified build nor a flat refusal: **name the scaffold cost and the cycles caveat in one honest sentence, then route to the cheaper faithful option that answers the same question** — a `MAKELINE` origin→destination flow map when the flows are geographic, or a 100%-stacked / part-to-whole bar for single-step proportional allocation — and offer to hand over the full scaffold recipe if the user genuinely needs the multi-step Sankey.

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: refine, create, validate, troubleshoot
- In-scope reason: Turns a "build me a Sankey / flow diagram" request into an honest propose-path — states why a proportional multi-step Sankey is a reshaped/densified scaffold (not a bindable field swap), warns that cycles break most implementations, and maps the underlying intent (geographic movement / single-step proportional allocation / full multi-step flow) to the faithful alternative so the guidance is a redirect, not a hallucinated build.
- Out-of-scope risk: none
- Tags: sankey, sankey-diagram, flow-diagram, flow-chart, alluvial, budget-allocation, flow-allocation, source-target, origin-destination, makeline, hundred-percent-stacked-bar, part-to-whole, densification, scaffold, reshape, sigmoid, cycles, propose-path, pushback, chart-selection
- Relevant user prompts/search terms: "build a sankey diagram", "make a sankey chart", "can you build a sankey", "sankey diagram for budget allocation", "flow diagram showing budget allocation", "visualize flow between source and target", "show how money flows between categories", "sankey showing flow between stages", "alluvial diagram", "flow chart of budget allocation across departments", "diagram showing where the budget goes", "origin destination flow", "sankey of user journey between steps"

## When to Use

Reach for this when a request implies a **proportional flow between nodes**:

- "Build me a Sankey" / "make a Sankey diagram" / "alluvial diagram."
- "Show how the budget flows / is allocated from X to Y (to Z)."
- "Visualize the flow between source and target" / "user journey between steps."
- Any multi-stage "where does it go" allocation where the width of each ribbon is proportional to a measure.

This is the *chart-choice honesty gate* for that specific request. For general chart selection see the chart-selection companion; for the full densified build mechanic (once the user accepts the scaffold cost) see the advanced-chart-builds companion.

## Best Practices

1. **Lead with the scaffold truth, not a silent build.** A proportional multi-step Sankey in Tableau is not a field swap onto the user's data — it is a *reshaped/densified scaffold*: each flow record is scaffolded and densified with a `t` bin (e.g. 1..49), a **sigmoid** calc maps `t` to the S-curve, and FIXED/rank calcs position each flow (Polygon curves + dual-axis Gantt end nodes). That scaffold *is* the source of truth. Say this in one sentence so the user understands why it can't be one-shot onto their table.
2. **Name the cycles caveat.** Cycles in the flows (A→B→A, or any back-edge) break most Sankey implementations and render incorrectly. If the user's flows can loop, flag it up front — do not fake a build that will silently mislead.
3. **Map the intent to the faithful alternative:**
   - *Flows are geographic (origin → destination, routes, movement between places)* → a **spatial O-D flow map**: `MAKELINE(MAKEPOINT([OLat],[OLon]), MAKEPOINT([DLat],[DLon]))` draws one line mark per route (latitude **first** in `MAKEPOINT`). This is the modern, no-reshaping native alternative to the densified-path Sankey hack; it needs a spatial-capable source.
   - *Single-step proportional allocation (one source split across parts, "what share goes where")* → a **100%-stacked bar** or a sorted **part-to-whole** bar. It answers "what proportion of the total goes to each destination" precisely, with no scaffold, and reads far better than a two-node Sankey.
   - *A genuine multi-step flow is truly required* → offer to **hand over the scaffold recipe** (the densified `t`-bin + sigmoid build) so the user can construct the full Sankey manually from a known-good reference workbook, rather than the agent guessing a densified build.
4. **Prefer the simpler Sankey variant if one is built at all.** If the user insists on a Sankey, the modern **Equal-Width Sankey** is easier and more robust than the classic proportional-curve scaffold — but it is still a scaffold, not a bind.
5. **Do not fabricate a densified build to look responsive.** There are **zero Sankey exemplars in the corpus**, so there is no golden to compile from or stamp against — a blind densified attempt is a correctness landmine, not a fast path.

### Honest propose-path language (say this)

> "A proportional multi-step Sankey in Tableau requires a reshaped/densified scaffold data source (a per-flow `t`-bin + sigmoid curve calc), not a field swap onto your data — so I can't one-shot it reliably, and cycles in your flows would render incorrectly. Cheaper faithful options: (a) a spatial origin→destination flow map via `MAKELINE(MAKEPOINT(...))` if your flows are geographic; (b) a 100%-stacked / part-to-whole bar for single-step proportional allocation; (c) I can hand you the scaffold recipe to build the full Sankey manually."

## Common Mistakes

1. **Silently hallucinating a densified Sankey build** onto the user's table — the core anti-pattern this entry exists to stop. The scaffold is the source of truth; there is nothing to field-swap into.
2. **Flat-refusing** ("Tableau can't do Sankeys") without offering the alternative that answers the question — untrue and unhelpful. It can, via a scaffold; the honest move is to propose the cheaper faithful path.
3. **Ignoring cycles** — building (or promising) a Sankey when the flows can loop; cycles render incorrectly and quietly mislead.
4. **Reaching for the Sankey when a 100%-stacked bar was the real ask** — a single-step "what share goes where" is a part-to-whole bar, not a two-node flow diagram.
5. **Densified-path Sankey for geographic movement** when a `MAKELINE` O-D flow map is native, no-reshaping, and more honest.
6. **Treating "non-blank" as "correct"** — a Sankey that renders is not necessarily a Sankey that's *right*; without a golden to verify against, the addressing/curve interpolation can be silently wrong.

## Implementation

1. Restate the underlying question: geographic movement, single-step proportional allocation, or a genuine multi-step flow?
2. Name the scaffold cost and the cycles caveat in one line (use the propose-path language above).
3. Route to the matching faithful alternative:
   - Geographic → `MAKELINE(MAKEPOINT(lat, lon), MAKEPOINT(lat, lon))` O-D flow map (latitude first; spatial-capable source required).
   - Single-step allocation → 100%-stacked or sorted part-to-whole bar (`% of Total`).
   - Multi-step required → hand over the densified scaffold recipe from the advanced-chart-builds companion (per-flow `t`-bin 1..49 + sigmoid + FIXED/rank positioning, Polygon curves + Gantt end nodes; keep the scaffold workbook as the source of truth), and build from a known-good reference rather than guessing.
4. If a Sankey is built, prefer the **Equal-Width Sankey** variant and set every table-calc **Compute Using** explicitly along the densification bin — addressing is the #1 failure mode.
5. Verify decisively: confirm the flows have no cycles, and open in Tableau to confirm the curve interpolation and end-node positions rendered as intended — a rendered scaffold is not proof of a correct Sankey.

## Related Knowledge

- `expertise://tableau/strategy/viz-design/chart-selection` — chart-choice routing; the "Flow / allocation" ask lands here, then routes to this propose-path rather than a densified build.
- `expertise://tableau/strategy/viz-design/advanced-chart-builds` — the full densified Sankey build mechanic (Polygon curves + Gantt end nodes, `t`-bin + sigmoid, Compute Using) and the `MAKELINE` O-D flow-map recipe, for when the scaffold is genuinely wanted.
- `expertise://tableau/tactics/data/lod-and-table-calc-patterns` — the FIXED/rank/positioning calcs and Compute Using addressing that make or break the scaffold.
- `expertise://tableau/strategy/viz-design/overlaid-and-stacked-pie-readability` — the sibling "push back, then propose the readable alternative" pattern for a different weak-chart request.

## Source and Confidence

- Source/evidence type: internal-doc synthesis
- Source: consolidated from this repo's advanced-chart-builds expertise module (densified Sankey scaffold, `MAKELINE` O-D flow map, Equal-Width Sankey) and the W22 use-case coverage analysis (UC8 "Flow / budget allocation — Sankey": zero corpus exemplars, cycles break most implementations, scaffold is not a bindable field swap); part-to-whole / 100%-stacked-bar alternatives are standard data-visualization best practice.
- Customer-identifying details removed: yes
- Confidence: draft
- Last reviewed: 2026-07-06
