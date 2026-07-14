# Viz Evaluation Framework: A Weighted Scorecard

A reproducible, weighted rubric for *scoring* a finished visualization or dashboard — the quantitative complement to the pass/fail peer-review gate. Where the peer-review checklist asks "does this clear the bar to publish?", this asks "how good is it, and where specifically does it lose points?" Use it to give calibrated, defensible feedback instead of a bare "looks good" / "looks bad."

Tags: evaluation, scoring, rubric, critique, design-quality, feedback, calibration

**Related strategy:** the *why* behind the domains lives in `expertise://tableau/strategy/viz-design/design-principles` (perceptual rationale), and the applied rules in `expertise://tableau/strategy/viz-design/chart-selection`, `expertise://tableau/strategy/viz-design/color-strategy`, `expertise://tableau/strategy/viz-design/encoding-strategy`. The publish gate is `expertise://tableau/strategy/dashboard-design/dashboard-peer-review-checklist`.

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: validate, refine
- In-scope reason: When the agent is asked to critique or grade a viz/dashboard (its own output or a user's), this gives a structured, weighted scoring method so feedback is calibrated and actionable rather than vibes-based — and tells the agent where a design actually loses points.
- Out-of-scope risk: none
- Tags: evaluation, scoring, rubric, critique, design-quality, feedback, calibration, genre, anti-anchoring, weighted-scorecard, viz-review
- Relevant user prompts/search terms: "rate my dashboard", "score this viz", "critique this visualization", "how good is this chart", "give me feedback on my dashboard", "evaluate this design", "what's wrong with this viz", "grade my Tableau dashboard", "is this dashboard good", "review the design quality"

## When to Use

Use this when:
- **A user asks you to rate, score, or critique** a viz or dashboard and wants more than a one-line reaction.
- **You want to give structured design feedback** on your own generated output before handing it back.
- **Two designs need comparing** on a consistent basis rather than by taste.
- **A reviewer needs a defensible number** — "6.5/10, losing most points on Layout and Color" — instead of an unfalsifiable opinion.

This is a *quality* assessment, not a *publish gate*. For the hard yes/no publish decision (classification labels, "All in list" filters, hardcoded dates, PII), run `dashboard-peer-review-checklist` — a design can score 8/10 and still be blocked from production by a governance failure.

---

## Step 0: Classify the Genre First (before scoring)

A design must be scored against what it is *trying to be*. Identify the genre first — it changes how you weight and interpret every domain:

| Genre | Purpose | How it shifts scoring |
|---|---|---|
| **Business / operational** | Monitor KPIs, drive decisions | Full weight on chart choice, clarity, and layout; expects KPIs and clear takeaways. |
| **Analytical / exploratory** | Let an analyst dig | Don't penalize for lacking big headline KPIs; reward depth, interactivity, correct encodings. |
| **Narrative** | Tell a sequenced story | Weight message and flow higher; a guided path matters more than density. |
| **Editorial / infographic** | Persuade a broad public | Some "useful chart junk" and annotation is a feature, not a flaw; plain-language text weighs more. |
| **Data art** | Aesthetic / provocative | Score honestly but note that conventional-clarity rules bend by design. |
| **Scientific / technical** | Precision for experts | Reward exact encodings, uncertainty, dense reference; low on decoration. |

**Rule:** never score an analytical exploration as if it were an exec dashboard, or vice versa. State the genre you scored against in the output — it makes the score falsifiable.

---

## The Weighted Scorecard

Score each domain 0–10, multiply by its weight, sum for a weighted total. Weights sum to 100%.

| Domain | Weight | What it measures |
|---|---|---|
| **Layout & Composition** | 25% | Reading order, alignment, whitespace, grouping, above-the-fold priority, density |
| **Chart Choice** | 20% | Right chart for the question and data shape; correct encodings; no misleading forms |
| **Audience Fit** | 15% | Matched to who reads it and how long they have; right filters and depth |
| **Color** | 15% | Purposeful palette (sequential/diverging/categorical/semantic); CVD-safe; contrast |
| **Message & Clarity** | 10% | One clear takeaway; titles/annotations state the "so what" |
| **Text & Labels** | 5% | Concise, meaningful labels; formatted tooltips; no field-name dumps |
| **Font & Typography** | 5% | Consistent, legible type hierarchy; not decorative for its own sake |

**Weighted total = Σ (domain score × weight).** Round to one decimal using round-half-to-even (banker's rounding) so repeated evaluations don't drift upward.

### Score tiers

| Weighted total | Interpretation |
|---|---|
| **9.0–10.0** | Exemplary — publish/showcase quality |
| **7.5–8.9** | Solid — competent and correct; minor polish left |
| **6.0–7.4** | Workable — real gaps to fix before it's trusted |
| **4.0–5.9** | Weak — a core domain (usually layout or chart choice) is failing |
| **< 4.0** | Broken — rebuild, don't patch |

### Anti-pattern penalties (applied after domain scoring)

Deduct from the weighted total for hard failures, regardless of how the rest scored:
- **Misleading encoding** (truncated bar axis, dual-axis with mismatched scales presented as comparable, 3-D perspective, area-encoded quantities): −1.0 to −2.0.
- **Rainbow/decorative color where sequence or category has meaning**: −0.5.
- **Unreadable density** (marks or text overlapping to illegibility at intended size): −0.5 to −1.0.
- **No discernible takeaway** on a business/narrative genre: −0.5.

### Bonus detection (rare, additive, cap +0.5 total)

Award only for genuine excellence, not mere competence: exceptional accessibility (CVD-safe + high contrast + labeled), an innovative-yet-clear chart that beats the conventional choice, or annotations that materially raise comprehension.

---

## Calibration: score what's present, then find gaps

The dominant failure mode in scoring is **negativity anchoring** — starting low and hunting for reasons to withhold points. Correct for it explicitly:

- **Floor for competent execution.** A correct chart choice with solid, clean execution starts at **7.5**, not 5. You deduct *from* competence for real problems; you don't build *up* to it from zero.
- **"Missed opportunity" ≠ "actual problem."** A design that could have added a reference line but reads correctly without one has a suggestion, not a deduction. Only deduct for things that harm comprehension, mislead, or fail the audience.
- **Proportional deduction.** A single awkward label is a 0.5-point ding on Text (5% weight ≈ 0.025 off the total), not a whole-grade drop. Keep the magnitude of the deduction tied to the domain's weight.
- **Score the genre, not your preference.** If you'd have made a different-but-equally-valid choice, that's not a deduction.

---

## Implementation

1. **Classify the genre** (Step 0) and state it. This fixes how you'll interpret each domain.
2. **Score each of the 7 domains 0–10**, writing one concrete sentence of evidence per domain ("Layout: 6 — the two KPI tiles and the trend line compete for the top-left; no clear reading order").
3. **Start each domain from the competence floor** (7.5 for correct-and-clean) and deduct proportionally for real problems, not missed opportunities.
4. **Compute the weighted total**, apply anti-pattern penalties and any (rare) bonus, and round half-to-even.
5. **Report:** the number, the genre it was scored against, the 2–3 lowest-scoring domains with the specific fix each needs, and the single highest-leverage change. Lead with what's working — the floor-first discipline should show in the write-up, not just the math.
6. **Separate quality from the gate.** If the design also has a publish-blocking governance issue, flag it separately and point to `dashboard-peer-review-checklist` — a high score does not clear the gate.

### Worked example (confirmed pattern)

A regional sales dashboard, classified **business/operational**:

| Domain | Score | Weight | Contribution | Evidence |
|---|---|---|---|---|
| Layout | 6.0 | 25% | 1.50 | KPI strip and trend compete for the top; no F-pattern order |
| Chart Choice | 8.0 | 20% | 1.60 | Bars for regions, line for trend — correct; one needless pie |
| Audience Fit | 7.5 | 15% | 1.125 | Exec-appropriate KPIs, but 6 filters is too many for a 15-sec scan |
| Color | 7.0 | 15% | 1.05 | Sequential ramp is fine; one accent color used decoratively |
| Message | 8.0 | 10% | 0.80 | Title states the takeaway clearly |
| Text | 8.0 | 5% | 0.40 | Tooltips formatted with numerator/denominator |
| Font | 8.0 | 5% | 0.40 | Consistent hierarchy |

Weighted subtotal = **6.875**. Anti-pattern penalty: the lone pie is not misleading, just suboptimal → no penalty (missed opportunity, not a problem). Rounded: **6.9/10**. Highest-leverage fix: **Layout** — establish a single reading order and demote the KPI strip's competition, which alone would lift the largest-weighted domain.

**What does NOT work:**
- **Scoring without declaring the genre** — an analytical viz graded as an exec dashboard reads as "too dense / no KPIs," which is a false negative. Always state the genre.
- **Averaging the 7 domains unweighted** — Layout (25%) and Chart Choice (20%) carry nearly half the score; a flat average lets a great font rescue a broken layout. Always apply the weights.
- **Deducting for taste** — "I'd have used a different palette" is not a defect. Deduct only for comprehension harm, misleading encodings, or audience mismatch.
- **Treating the score as a publish decision** — quality and the governance gate are orthogonal. Report both, separately.

## Best Practices

- **Genre before number.** The single most common calibration error is scoring against the wrong intent.
- **Floor-first, deduct down.** Competent work starts at 7.5; you take points off for real problems, you don't grant them for the absence of problems.
- **Weight-proportional deductions.** A Text nit and a Layout failure are not the same size — tie the ding to the domain weight.
- **Evidence per domain.** Every score needs one concrete, quotable observation, or it's not defensible.
- **Lead with strengths, then the highest-leverage fix.** A critique that only lists faults gets ignored; name the one change that moves the biggest-weighted domain.

## Common Mistakes

1. **Negativity anchoring** — starting low and looking for reasons to raise. Start from the competence floor and deduct for actual harm.
2. **Unweighted averaging** — treating a 5%-weight font issue as equal to a 25%-weight layout failure.
3. **Confusing "missed opportunity" with "problem"** — deducting for a reference line that wasn't added, even though the viz reads correctly without it.
4. **Genre blindness** — penalizing an exploratory analytical dashboard for lacking headline KPIs.
5. **Conflating score with gate** — reporting a high score as if it means "safe to publish" when a classification/PII/filter failure is present.

## Source and Confidence

- Source/evidence type: community-adapted best practice
- Source: Weighted-scorecard evaluation methodology adapted from `adammico-lab/VizCritique-Pro-BETA` (Adam Mico, Apache 2.0), curated to house format and de-branded; cross-referenced against the existing `design-principles` and `dashboard-peer-review-checklist` modules. Domain weights and calibration philosophy are the source's; genre taxonomy is the source's, condensed.
- Customer-identifying details removed: yes
- Confidence: SME-reviewed
- Last reviewed: 2026-07-13
