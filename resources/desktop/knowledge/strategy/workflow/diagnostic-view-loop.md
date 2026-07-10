# Diagnostic View Loop: Test Data Assumptions Before Committing to a Viz

SE knowledge entry for field-observed authoring behavior that should guide BI agents when a user challenges a recommendation or the agent realizes it is relying on an untested data assumption.

## Scope Check

- Primary audience: Tableau user / SE assisting a Tableau user
- Authoring outcome improved: validate, create, improve
- In-scope reason: Helps an agent turn a challenged recommendation or implicit assumption into a small, evidence-backed diagnostic view before committing to a final visualization design.
- Out-of-scope risk: none
- Tags: diagnostic view, assumption testing, hypothesis check, data validation, exploratory analysis, evidence-backed recommendation, throwaway sheet, iterative authoring, replace weak viz, user challenge
- Expected agent behavior: When the user questions the agent's recommendation or the agent notices it has made an implicit assumption, the agent should acknowledge the assumption, build the smallest diagnostic view that can test it against the real data, state the result, and use that evidence to improve or replace the proposed visualization.
- Relevant user prompts/search terms: "why did you choose that chart", "are you assuming this field behaves that way", "prove that recommendation", "check the data before building", "test your assumption", "that chart does not seem right", "can you verify this pattern", "build a diagnostic view first", "replace this weak viz with a better one"
- Safe refusal condition: Do not present the diagnostic finding as proof if the available data cannot test the hypothesis, the sample is too small, or the relevant fields are missing; explain the limitation and ask whether to proceed with a caveated design or pause for better data.

## When to Use

Use this guidance when a user challenges the agent's recommendation, asks why the agent chose a chart or analytic approach, or points out that the recommendation may be based on an assumption about the data.

Also use it when the agent catches itself relying on an unverified assumption, such as "the categories are balanced enough for this comparison," "this measure varies by segment," "the relationship is roughly linear," "the top performers are stable over time," or "this existing view is the best way to show the pattern."

This is not a replacement for normal discovery-first authoring. It is a short loop inside an authoring session: acknowledge the uncertainty, create a small diagnostic view, read the data signal, then either proceed, revise, or replace the weaker visualization.

## Best Practices

- Acknowledge the assumption plainly. If the user questions the recommendation, do not defend the original answer reflexively. Say what assumption the recommendation depended on and that you will test it against the actual data.
- Build the smallest diagnostic view that can answer the question. Prefer a throwaway worksheet, table, histogram, scatterplot, box plot, small multiple, or simple ranked bar over a polished dashboard.
- Name the diagnostic view clearly while working, using labels such as `DIAGNOSTIC - Segment Distribution` or `DIAGNOSTIC - Trend by Region`, so it is not mistaken for final deliverable content.
- Test one hypothesis at a time. The view should answer a specific question: "Is the distribution skewed?", "Does the relationship hold within each segment?", "Are the top categories stable?", or "Is this aggregate hiding subgroup differences?"
- Read the result back before building. State what the diagnostic view proved, disproved, or failed to determine. Then connect that result to the design decision.
- Use the diagnostic finding to improve the workbook, not just to justify the original recommendation. If the evidence shows the original view is weaker, replace it with the better view.
- Remove, hide, or clearly separate diagnostic sheets before final delivery unless the user wants to keep them as an audit trail or exploratory appendix.
- Keep the loop short. A diagnostic view is a decision aid, not a second dashboard project.

### When to Say No

Say no to treating a diagnostic view as conclusive when the data cannot support the test.

Recommended wording:

> I can test that assumption with a quick diagnostic view, but the current data does not contain the field or grain needed to prove it. I can either build a caveated version using the closest available evidence, or we can pause until the right data is available.

Offer this instead:

- A caveated recommendation that states the untested assumption.
- A narrower diagnostic test using fields that do exist.
- A request for the missing field, grain, or time period needed to verify the hypothesis.

## Common Mistakes

- Defending the first recommendation instead of testing it. A user challenge is often a signal that the agent made an implicit assumption the user can see.
- Building a polished replacement before diagnosing the issue. Without the diagnostic step, the agent may simply swap one unsupported design for another.
- Making the diagnostic view too broad. A throwaway sheet should answer one question quickly, not explore every possible slice.
- Forgetting to use the result. The loop is only valuable if the diagnostic finding changes or confirms the final design decision.
- Leaving diagnostic sheets in the final workbook without explanation. They can confuse users if they look like unfinished deliverables.
- Treating exploratory findings as final proof. A diagnostic view can validate whether a design is appropriate for the current workbook, but it does not automatically establish causality or long-term stability.

## Implementation

1. **Notice the challenge or assumption.** Trigger the loop when the user questions a recommendation, when the agent says or implies "this probably," or when the proposed design depends on a data shape that has not been checked.
2. **State the hypothesis.** Convert the assumption into a testable sentence: "I assumed sales concentration is high enough that a Top-N view will be useful."
3. **Create a small diagnostic view.** Use the simplest worksheet or exploratory view that can test the hypothesis against the actual data.
4. **Read the result.** Summarize what the view shows in plain language, including uncertainty or limitations.
5. **Decide.** Keep the original design if the hypothesis holds, revise it if the evidence points elsewhere, or pause if the hypothesis cannot be tested.
6. **Replace weak output when needed.** If an existing visualization is less informative than the evidence-backed alternative, replace it rather than leaving both as competing answers.
7. **Clean up.** Remove, hide, or label the diagnostic sheet according to whether the user wants an audit trail.

### Worked Example

**Hypothesis:** The agent recommends a ranked bar chart of product categories because it assumes a few categories dominate revenue. The user asks, "Are you sure this should be a Top-N chart? What if revenue is evenly spread?"

**Diagnostic sheet:** The agent creates `DIAGNOSTIC - Revenue Concentration`, a simple sorted bar chart of revenue by product category with percent of total in the label or tooltip. It checks whether the top categories account for a large share of total revenue and whether there is a meaningful drop-off.

**Decision:** The diagnostic view shows revenue is not concentrated: the top category is only slightly above the next several categories, and the long tail still contributes materially. The agent states that the Top-N assumption was weak, then replaces the original Top-N chart with a distribution-focused view, such as a full sorted bar chart grouped by category family or a treemap only if the user needs part-to-whole scanning. The final explanation says the design changed because the real data showed broad contribution rather than a dominant few categories.

## Related Knowledge

- Extends [Discovery-First Authoring: Inventory and Align Before You Build](data/knowledge/personalization/discovery-first-authoring.md): this entry covers the in-session loop to test a specific assumption after discovery or after a user challenge.
- Related to [Validate Data Availability and Quality Before Building a Dashboard](data/knowledge/personalization/validate-data-before-building.md): both entries prevent unsupported builds; this one focuses on fast, throwaway diagnostic views used to verify design assumptions.
- Related to [Chart Type Selection](data/knowledge/strategy/viz-design/chart-selection.md): diagnostic views help stress-test whether the selected chart type matches the actual data shape.

## Source and Confidence

- Source/evidence type: live SE session
- Source: Ben Hart, live session, 2026-07-09
- Customer-identifying details removed: yes
- Confidence: field-observed
- Last reviewed: 2026-07-09
```
```markdown
- Verify assumptions with a throwaway diagnostic view before committing to a design → `strategy/workflow/diagnostic-view-loop`
