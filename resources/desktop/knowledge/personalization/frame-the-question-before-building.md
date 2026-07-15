# Frame the Question and Check the Data Before Building

## Scope Check

- Primary audience: prompt-driven dashboard/viz builders (Tableau Next, Pulse,
  Concierge, AI authoring) and new authors at the very start of a build, before any
  prompt is issued or worksheet is created.
- Authoring outcome improved: forces the business question, the data's structure, and
  the builder's intent to be established first, so the resulting dashboard actually
  answers a decision instead of producing a plausible-looking viz that answers nothing
  — and so unexpected results get validated rather than dismissed.
- In-scope reason: directly improves how a prompt-driven build turns an eager "make me
  a dashboard" into a viz that answers a real decision at the data's true grain.
- Out-of-scope risk: not a project-scoping, requirements-gathering, or account-strategy
  framework — scoped to the kickoff of a single authoring session.
- Tags: framing, business question, grain, data fit, metric definition, defaults,
- Relevant user prompts/search terms: "how do I frame the question before building", "what should I ask before making a dashboard", "help me scope this dashboard", "what question should this dashboard answer", "is a dashboard the right answer", "check the data before building", "define the metric before building", "understand the grain first"
  validation, unexpected results, dashboard vs data product, when to say no, vibe
  coding, prompt-driven authoring
- Customer-identifying details removed: yes.

## When to Use

Use this at the kickoff of any prompt-driven authoring session — especially with a
new user who is eager to start typing prompts. Three foundational things must be
established *before* building: understand the data, frame the question the dashboard
must answer, and know what kind of answer a dashboard can credibly give.

## Understand the Data Before You Build

Most business users won't know this about their data, but it's good information to
have if you can find it. Once you understand a little about the structure of the data,
you can better judge whether it's useful for the dashboard you want to build.

- **Where did the data come from?**
- **Who collected it?**
- **What time period does it cover?**
- **What does one row represent?** This is the single most important question. In
  Superstore, one row represents one product line item of a single order, and a single
  order can have multiple line items. If a customer orders multiples of one product,
  that's still one row, with a quantity field holding the number ordered. Get the grain
  wrong and every aggregation downstream is wrong.
- **What are the key measures and dimensions?**
- **What's in the data that provides context but isn't used for analysis all the time?**

### Fit: is this the right data for this question?

- **Who uses this data in real life?**
- **What kinds of questions do people use it to answer?** A Finance data set probably
  won't be very useful to an HR user, even if some columns overlap with what an HR user
  needs. Overlapping fields are not the same as fit.

## Understand the Request Before You Build

New users — to Tableau and to their own data — describe what they want to *see*,
not what they need to *know*. In a prompt-driven (vibe-coded) build, treating the
visual request as a complete specification is the fastest way to produce output that
is technically correct and analytically thin. Work through the request itself before
choosing how to represent it.

- **The visual request is not the spec.** "Show me sales by region" is a visual
  request; the underlying need is usually a decision — "which regions are
  underperforming." Surface the decision behind the request first, then choose the
  representation that serves it.
- **Plain-language field names rarely map one-to-one.** Users name fields in plain
  language that may or may not match the dataset. "Revenue," "Sales," and "Total"
  might be the same field — or three different ones. Acting on the plain-language
  description without confirming the actual field name is one of the most reliable
  ways to produce a viz that looks right but calculates wrong.
- **Establish grain before any aggregation — they won't raise it.** Most users don't
  know what grain means and won't think to mention it, but grain decides whether an
  aggregation is correct (see *Understand the Data* above). A Superstore-style source
  where one row is an order line item produces inflated totals the moment it's treated
  as one row per order.
- **Pin down the metric definition.** The same metric name means different things
  across datasets, departments, and business contexts. "Revenue recognized" and
  "revenue booked" sound alike and calculate very differently. When a user names a
  metric without saying how to calculate it, assume they don't know the distinction
  exists — not that they want the default interpretation.
- **Make the defaults visible.** Every visualization carries invisible decisions —
  time period, filter scope, aggregation method, sort order. A user new to Tableau
  won't know these are being made on their behalf, and won't know to question them
  when the output looks plausible. State the defaults as part of explaining the
  output, so a non-technical user can actually validate what they're looking at.
- **Read iteration symptoms back to a cause.** Users new to prompt-driven building
  iterate by describing what looks wrong *visually* rather than what's wrong
  *analytically*. "The numbers seem too high" is a symptom; the cause is usually
  grain, aggregation, filter scope, or metric definition. Diagnose it in the data
  layer rather than just nudging the visual.
- **Plausible is not correct.** A visualization that looks plausible is not the same
  as one that is correct, and for a user who doesn't know the data well, plausible
  wrong output is more dangerous than obviously wrong output — because it gets used.
  After generating a viz, explain what it shows, how the key numbers were calculated,
  and what was assumed, so the user has something concrete to validate against.

## What Dashboards Are Good At

Dashboards are great at answering specific pattern-based question types:

- **Magnitude** — how much, how many
- **Comparisons** — across categories, regions, products
- **Change over time**
- **Distribution** — highs, lows, outliers

To a lesser extent, dashboards can help with deeper pattern-based questions, but it
usually takes an analyst or an agent to pull all the nuance out of the result:

- **Correlation**
- **Driver analysis**

Match the business question to one of these shapes. If the question doesn't map to a
pattern a dashboard answers well, that's a signal to reframe it or route it to an
analyst/agent.

## Best Practices

- Establish the grain first ("one row = one ___") and verify the needed
  dimensions/measures exist at that grain. Where time matters, confirm a true
  date-typed column and the right calendar (fiscal vs. calendar are very different).
- Make the user state the business question in one plain sentence, then map it to the
  specific fields that will answer it. Surface missing or derived fields now.
- Be curious, and expect that some visualizations won't show what you predicted —
  that's the *point* of a dashboard. It exists to surface insight about the data, not
  to confirm what you already believe.
- When you see results you don't expect, work to validate them rather than assuming the
  viz is wrong. Sometimes an unexpected number is the right answer to a slightly
  different question than the one being asked.
- Decide up front whether you're building a point-in-time **dashboard** or a durable
  **data product**, and build accordingly (see below).

### Validating unexpected results

When a number looks off, work through the structural causes before concluding the viz
is broken:

- **Filters:** Is a filter distorting the scope from what you expect?
- **Data quality:** Are nulls or duplicate values skewing the result?
- **Time period:** Does it match what you need? Calendar and fiscal calendars differ.
- **Right fields:** For sales, revenue *recognized* vs. *booked* vs. *billed* can show
  very different results even though they sound alike.
- **Aggregation:** `SUM()` and `COUNT()` on the same field usually produce different
  results — is the aggregation right?
- **Right data set:** Are you even using the correct source?
- **Reframe the question:** What does the viz show if you ask it differently? In
  Superstore, total *sales by customer* makes Sean Miller look far larger than others;
  if you actually need *quantity* rather than *sales amount*, that's a different
  question. Reframing also helps check for outliers.

When all the structural elements seem right but it still looks off, validate outside
the dashboard if you can:

- Check with an SME familiar with the data.
- Compare against existing reports or records.
- Sanity-check direction: is the number directionally plausible given what's known
  about the business?

## Dashboard vs. Data Product

Consider the intent of the final artifact — this helps you build a *data product*
instead of a *dashboard* when that's what's actually needed.

A **dashboard** is a collection of visualizations answering point-in-time questions,
often the *builder's* questions rather than a broad audience's. Think of a dozen
versions of a revenue dashboard built by different teams off largely the same data.

A **data product** has more intent: it's built to answer a group of questions
successfully over time, is maintained to stay relevant, and can withstand rigorous
scrutiny across several metrics. Signals you're building (or should build) a data
product:

- Does it use governed, certified metrics, or calculations embedded in the dashboard?
- Is the scope well defined — built for specific roles/classes of users asking specific
  groups of questions (a scope that can and should evolve with business needs)?
- Is someone accountable for long-term accuracy, freshness, and for making sure user
  questions are actually answered?
- Is the data trustworthy enough that users can act without re-validating elsewhere?
- Is it easily found by users?
- Does it include documented lineage?

## When to Say No

- If the user can't state the business question in one sentence, don't build yet —
  pause and pin down the decision first.
- If the question doesn't map to a shape a dashboard answers well (magnitude,
  comparison, change over time, distribution), reframe it or route the deeper
  correlation/driver work to an analyst or agent.
- If the requested dashboard requires a grain or a measure the data does not contain,
  stop and say so before building. Don't let a prompt-driven tool generate a
  confident-looking answer the data can't actually support.
- If time is central but no true date-typed column exists, or the wrong calendar is in
  play, say the time view isn't reliable until that's resolved.

What to say instead: propose a narrower question the data *can* answer at its real
grain, name the data work (new field, regrain, real date column, certified metric)
needed first, or — when the need is durable and cross-team — propose a governed data
product rather than yet another one-off dashboard.

## Common Mistakes

- **Building before defining the question** (the most common failure). The user jumps
  straight into prompting, the tool returns a viz, and only later does everyone realize
  it doesn't answer any actual business question. Effort is wasted and trust drops.
- Getting the grain wrong — not knowing what one row represents — so every aggregation
  is subtly (or badly) off.
- Assuming overlapping columns mean the data *fits* the question (the Finance-vs-HR
  trap).
- Assuming an unexpected visualization is wrong, and "fixing" it, when it's actually
  the correct answer to a different question — or a real outlier worth investigating.
- Mismatched fields or aggregations that sound interchangeable but aren't (recognized
  vs. booked vs. billed revenue; `SUM` vs. `COUNT`).
- Wrong or mixed calendars (fiscal vs. calendar) distorting time views.
- Building a one-off dashboard when the durable, cross-team need called for a governed
  data product.

## Implementation

At session start, before any prompt or worksheet:

1. **Interrogate the data.** Establish provenance, time coverage, grain ("one row =
   one ___"), key measures/dimensions, and context fields. Confirm a real date column
   and the correct calendar if time is involved.
2. **Check fit.** Confirm this data is actually used for the kind of question being
   asked — overlapping fields are not enough.
3. **Frame the question.** Get a one-sentence business question, restate it, and map it
   to the specific fields that will answer it. Raise anything missing or derived now.
4. **Match to a dashboard-friendly shape** (magnitude / comparison / change over time /
   distribution). If it's deeper correlation/driver analysis, set expectations or route
   it to an analyst/agent.
5. **Build scoped, single-intent prompts** — one question per prompt.
6. **Validate unexpected results** against the checklist above (filters, nulls/dupes,
   time period, fields, aggregation, data set, reframing) before assuming the viz is
   wrong; validate outside the dashboard when structure checks out but it still looks
   off.
7. **Decide dashboard vs. data product** based on whether the need is point-in-time or
   durable and cross-team, and build to that intent.

## Related Knowledge

- Discovery-First Authoring — inventory the workbook's real state before building: `expertise://tableau/personalization/discovery-first-authoring`
- Validate Data — availability and quality (nulls, grain, freshness) before building: `expertise://tableau/personalization/validate-data-before-building`

This entry shares the pre-build "understand the data and the request before you build"
spine with two related authoring-patterns entries, and likely overlaps with them on
the data-validation and mismatch-flagging guidance:

- Relates to [Validate Data Availability and Quality Before Building a Dashboard](data/knowledge/personalization/validate-data-before-building.md):
  the data-validation and availability/quality checks here extend its
  exploration-vs-specific-question framing and source-of-truth escalation guidance.
- Relates to [Discovery-First Authoring: Inventory and Align Before You Build](data/knowledge/personalization/discovery-first-authoring.md):
  the "confirm the field exists, don't fabricate, restate the goal, flag the mismatch"
  moves here are the agent-turn-level version of that inventory-and-align preamble.

## Source and Confidence

- Source/evidence type: field-tested, customer-safe (generalized examples only)
- Source: SE field experience coaching new prompt-driven builders; Superstore used for
  generalized, non-customer examples.
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-23
