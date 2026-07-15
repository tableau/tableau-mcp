# Tableau Is the Analytics Layer, Not the Fix: The Interim Report Pattern

SE knowledge entry for field expertise that may later be reviewed for promotion into the Tableau authoring expertise layer.

## Scope Check

- Primary audience: SE assisting a Tableau user
- Authoring outcome improved: govern, safely decline
- In-scope reason: Helps Claude and SEs handle requests to replicate complex upstream logic inside Tableau — explaining why Tableau is the wrong place for the fix, establishing guardrails when a short-term interim report is appropriate, and declining when the risk of bad data outweighs the benefit of short-term delivery.
- Out-of-scope risk: none
- Tags: shadow logic, system of record, interim report, exception report, monitoring report, technical debt, report portfolio, report purposing, upstream fix, data warehouse, guardrails, business accountability, stakeholder management, report governance
- Expected agent behavior: When a user asks Claude to build complex logic in Tableau that should live upstream in the data warehouse or application, Claude should explain Tableau's role as an analytics layer, assess whether an interim report with guardrails is appropriate, and decline when the logic cannot be faithfully replicated or when customer harm risk is present.
- Relevant user prompts/search terms: "when is Tableau the wrong tool", "should I build this in Tableau or fix it upstream", "am I building a workaround", "this belongs in the data warehouse not a dashboard", "replicating business logic in Tableau", "interim report vs system of record", "should this logic live upstream", "Tableau as a band-aid for a data problem"
- Safe refusal condition: When the requested logic cannot be accurately replicated in Tableau, or when the use case involves regulatory compliance where bad data could cause customer harm (missed closings, incorrect fees, bad funding data).

## When to Use

Use this guidance when a business user asks for a Tableau dashboard that replicates complex logic, calculations, or processing that belongs upstream in a data warehouse, application, or system of record — and especially when the user's underlying need is a fix that the data or application team has not yet applied.

This applies to:

- Business users who need a near-term answer while an upstream fix is in queue
- Teams that have inherited dashboards with embedded workaround logic and no clear expiration
- Any organization where a reporting or analytics team sits separately from the application and data warehousing teams

## Best Practices

- Frame Tableau as the analytics layer and companion to the system of record, not a substitute for it. The fix belongs upstream; Tableau can surface the data but cannot own the data.
- When short-term delivery is appropriate, establish an interim report with explicit guardrails before building anything:
  - Coordinate a realistic timeframe with all three parties: the data warehouse or application team, the analytics/dashboard team, and the business user.
  - Attach named stakeholders from each team who are accountable for the upstream fix and for the report's continued relevance.
  - Add a sub-header to the dashboard as part of the report purpose section. State the purpose clearly and indicate the expected fix timeframe in broad terms — do not promise a hard deadline.
  - Build in a monitoring routine: 30-day, quarterly, or semi-annual check-ins depending on how long the fix is expected to take.
- At each check-in, assess five questions: Does the business purpose of this report still align with a real need? Is Tableau still the right place to surface it? Are the named stakeholders still the correct owners? Does the current access list reflect who should actually be able to see this data? Is anyone actively using the report at the intended cadence — and has the upstream fix already been applied without the reporting team being notified?
- Communicate clearly that the interim report is a short-term inspection and accountability tool, not a permanent solution. The goal is to give the business a window into the problem while the real fix is applied, not to make the workaround permanent.

### When to Say No

Say no to building even an interim report when:

- The upstream logic is too complex to replicate accurately in Tableau — particularly complex SQL, multi-system data pulls, or logic that would produce unreliable results if approximated.
- The use case involves regulatory or compliance workflows where a bad data output could cause customer harm: missed loan closings, incorrect fees, bad funding data, or regulatory reporting errors. In these cases, giving bad data is worse than giving no data.
- The requested data scope cannot be made analytically valid because underlying systems changed during the requested period. For example, a user asks for 5 years of loan data but the origination system was replaced 2 years ago — merging data across the old and new system produces a dataset that looks continuous but is not comparable across the boundary. Presenting it as continuous creates misleading analysis. In these cases, confirm the meaningful analysis window with the data warehouse or application team before building anything.
- The data requested exposes PII or creates risk that the output could be used for customer harm — for example, surfacing fields that enable identity theft, fraud, fair lending violations, or other misuse by bad actors. A single field may appear safe, but the combination of fields in a dashboard can create exposure that is not visible until the full dataset is assembled. In these cases, do not build the report. See also: [PII and Fair Lending Field Exclusions](data/knowledge/tactics/governance/pii-and-fair-lending-exclusions.md).

Recommended wording:

> Tableau is your analytics layer — it can show you what's in your data, but it can't own the fix. What you're describing needs to be corrected upstream in the data warehouse or application, and I want to make sure we don't build something here that gives you a false sense that the problem is solved.
>
> If the upstream team has a fix in queue, I can help you build a short-term monitoring report with a clear purpose statement and a check-in schedule — so the business has visibility while the real fix lands. But if the logic is too complex to replicate safely, or if there's any risk of surfacing incorrect data in a regulated process, I'd recommend we hold off and support the upstream ticket directly instead.

Offer this instead:

- An interim monitoring report with a defined timeframe, named stakeholders, a report purpose sub-header, and a check-in routine — when the logic can be faithfully replicated and the risk is low.
- Direct support for the upstream fix request (helping document requirements, escalating the ticket priority) when an interim report is not appropriate.

## Common Mistakes

- Building the shadow logic without guardrails and treating it as a normal dashboard. Without a defined purpose, timeframe, stakeholders, and monitoring routine, the report will outlive its reason for existing and become permanent technical debt.
- Inheriting workaround dashboards without auditing them. Reports built as temporary fixes frequently survive well past the upstream fix being applied — nobody checks, and the Tableau dashboard becomes the de facto system of record by default.
- Putting a hard deadline in the report sub-header. Promising "fix expected by Q3" when the timeline is uncertain creates expectation risk. Use broad language: "fix in progress as of this quarter" or "expected to be resolved in the next 6–12 months."
- Taking on regulatory or compliance workarounds. Even with good intentions, surfacing approximated data in a regulated workflow creates customer harm risk that the analytics team should not own.
- Skipping the monitoring routine. A report with a purpose statement and stakeholders but no check-in cadence will drift. Active portfolio monitoring — confirming the upstream fix has landed and decommissioning the interim report — is what keeps the methodology honest.
- Not reviewing access during check-ins. Over time, the people who originally needed the interim report change roles, leave the team, or no longer require the data. Without an explicit access review at each check-in, users who should no longer see the data retain access by default.
- Agreeing to pull broad historical data without validating whether system changes make the full date range analytically meaningful. If the underlying system was replaced or significantly restructured mid-period, data from before and after the cutover may not be comparable — presenting it as a continuous series creates misleading analysis and gives the business false confidence in the output.
- Building a data-rich dashboard without reviewing whether the field combination creates PII or data exposure risk. Individual fields may each appear safe, but the dashboard as a whole can enable identity theft, fraud, or other misuse when enough personally identifiable or sensitive attributes are surfaced together.
- Assuming someone will notify the reporting team when the upstream fix lands. In practice, the data warehouse or application team closes their ticket and moves on — they do not reliably loop back to inform the reporting team. If the reporting team does not proactively check at each cadence, an interim report can keep running long after the upstream fix has been applied, consuming CPU against the data warehouse and occupying licenses and capacity that could be repurposed for higher-priority work.

## Implementation

1. **Acknowledge the goal.** Confirm what the business user is trying to accomplish and why the upstream data or application is not currently meeting that need.
2. **State Tableau's role clearly.** Explain that Tableau is the analytics layer — a companion to the system of record, not a replacement for it. The fix needs to be applied upstream.
3. **Assess whether an interim report is appropriate.** Can the logic be faithfully replicated? Is the fix genuinely in queue with a realistic timeframe? Is the use case free of regulatory or customer harm risk?
4. **If yes — build the interim report with guardrails:**
   - Coordinate a timeframe with the data warehouse or application team, the dashboard team, and the business user.
   - Attach named stakeholders who own the upstream fix and the report accountability.
   - Add a sub-header to the dashboard: state the purpose and the expected fix window in broad terms.
   - Establish a check-in cadence: 30-day for short fixes, monthly or quarterly for multi-year efforts.
5. **If no — redirect to the upstream fix.** Explain the risk, decline to build an approximation, and offer to help document or escalate the upstream request instead.
6. **Maintain the monitoring routine.** At each check-in, confirm five questions: purpose still valid, Tableau still right, stakeholders still correct, access list still appropriate, upstream fix still pending. Do not assume the data warehouse or application team will notify you when their fix lands — check proactively. When the fix is confirmed, decommission the interim report and reclaim the licenses and data warehouse capacity it was consuming.

## Related Knowledge

- Extends [Dashboard Overload: Redirecting Customers Who Want Too Much on One Dashboard](data/knowledge/strategy/dashboard-design/dashboard-overload.md): both entries address redirecting a business user toward a better-structured solution; this entry covers the upstream fix scenario specifically.
- Related to [PII and Fair Lending Field Exclusions](data/knowledge/tactics/governance/pii-and-fair-lending-exclusions.md): both identify regulated use cases where the analytics team should decline rather than approximate.

## Source and Confidence

- Source/evidence type: field-tested
- Source: SE managing a dashboard authoring team at a major financial institution, covering regulatory and operational reporting across a large-scale Tableau deployment
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-11
