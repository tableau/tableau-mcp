# Validate Data Availability and Quality Before Building a Dashboard

## Scope Check

- Primary audience: Tableau user or analyst working in the product
- Authoring outcome improved: create, validate, troubleshoot
- In-scope reason: Guides Claude to prompt analysts to check data availability and quality before building, preventing costly mid-build discoveries of missing or broken data.
- Out-of-scope risk: none
- Tags: pre-authoring, data-exploration, data-quality, dashboard-planning, data-availability, dimensions, measures, data-governance, data-warehouse, analyst-workflow
- Expected agent behavior: Before helping build a dashboard, Claude should assess the analyst's goal (exploration vs. answering a specific question), check that the required data exists and is of sufficient quality, summarize its findings, and only proceed to visualization if the data checks out. If gaps are found, Claude surfaces them and asks the analyst how to proceed rather than building on flawed foundations.
- Relevant user prompts/search terms: "help me build a dashboard", "where do I start", "I want to visualize my data", "create a dashboard", "analyze my data", "I have a data question to answer"
- Suggested golden task: Ask Claude to help build a dashboard for a specific business question; verify that Claude checks for the relevant fields and flags any missing or low-quality data before producing a visualization.
- Safe refusal condition: Claude should not build a visualization when required data fields are missing or data quality issues are unresolved — it should surface the gaps and ask the analyst what to do next.

## When to Use

Use this guidance when a Tableau user or analyst asks Claude to help them build a dashboard or analyze their data. Apply it at the start of any authoring session, before any visualization is created.

This applies to:

- Analysts who have been asked to answer a specific business question and need to verify their data can support it.
- Analysts who are exploring a dataset and want to discover what questions they can answer.
- Any situation where the analyst may not yet know whether their data is available, complete, or trustworthy.

## Best Practices

- Begin by asking the analyst what they want to achieve: are they exploring data to find insights, or do they have a specific question to answer? These two modes call for different approaches.
- For the **specific-question mode**: validate that the data needed to answer the question exists and is of sufficient quality. Write a brief summary of findings — what is available, what is missing, and any quality issues found (missing fields, missing values, mismatched identifiers, incomplete coverage). If the data checks out, proceed to build following visualization best practices. If gaps are found, stop and ask the analyst what the best next step is. Where possible, help identify who owns the missing data or what needs to be resolved at the source.
- For the **exploration mode**: review the available fields — attributes (dimensions) and metrics (measures) — and recommend a set of questions the analyst could answer with the data they have. Offer a mocked-up or starter dashboard that visualizes key trends, and suggest relevant analyses including forecasting, segmentation, or other statistical approaches where appropriate.
- Always distinguish between data availability issues (the data does not exist or is not modeled where expected) and data quality issues (the data exists but is incomplete, mismatched, or unreliable). Both can derail an analysis.
- Encourage the analyst to sketch or describe how they want the dashboard to look before building — early layout thinking prevents rework.
- When data issues are found, recommend fixing them at the source through the appropriate data or governance team rather than applying short-term workarounds in the workbook, which can introduce errors and shift accountability away from the right owner.

### When to Say No

Say no to building a visualization when required data is missing or data quality issues have not been resolved.

Recommended wording:

> I found some gaps in your data before we start building — for example, a required field is missing, some values are incomplete, or identifiers are inconsistent across sources. Building a dashboard on this data now could lead to incomplete or misleading results. What would you like to do — should I help you identify who owns this data or what would need to be fixed before we proceed?

Offer this instead:

- A summary of what data is available and what is missing or low quality.
- Guidance on who typically owns the missing data (data warehousing team, data governance team, a specific department) if Claude can infer this from context.
- A suggestion to revisit the dashboard after the data issue is resolved at the source.

## Common Mistakes

- Starting to build visualizations before checking whether the required data exists or is complete — this often leads to discovering gaps mid-build and having to restart the analysis.
- Treating a data availability problem as a permissions issue when the data may simply not exist in the warehouse or may not be modeled where expected.
- Applying a short-term fix in the workbook (such as hardcoding values or joining on an unreliable key) instead of escalating the quality issue to the data team — this can introduce errors and shift accountability away from the appropriate owner.
- Skipping data quality checks and assuming data from multiple vendors or sources is consistent — identifiers for the same entity can differ across sources or be missing entirely.
- Not confirming with the analyst what "success" looks like for the dashboard before building — a layout sketch or a clear question statement prevents misaligned output.

## Implementation

**For the specific-question workflow:**

1. Ask the analyst to state the specific question they need to answer and identify the key fields required.
2. Review the available data for those fields: check for presence, completeness, and consistency (e.g., do identifier fields match across sources?).
3. Write a short data quality summary: what is available, what is missing, and what quality issues exist.
4. If the data checks out, proceed to build the visualization following Tableau authoring best practices.
5. If gaps are found, present the summary and ask: "What would you like to do next?" Offer to help identify the data owner or describe what needs to be resolved at the source.
6. Do not apply short-term workarounds in the workbook without flagging the risk and confirming with the analyst.

**For the exploration workflow:**

1. Review the available fields — list the dimensions (attributes) and measures (metrics) in the dataset.
2. Suggest 3–5 questions the analyst could explore given what is available.
3. Offer a starter or mocked-up dashboard that visualizes the most actionable trends.
4. Note where machine learning, forecasting, or segmentation could add value and suggest incorporating those if the analyst is interested.

**Field example:** An analyst at a financial services firm tried to add a securities-level exposure view to a firm-wide dashboard — showing the firm's exposure to individual stocks and bonds across sectors, currencies, and regions. The required field, a common securities identifier (CUSIP), was missing from some vendor data sources, mismatched in others, and replaced with a different identifier for certain securities. The analyst discovered this mid-build while querying the data warehouse, leading to approximately two weeks of investigation and coordination with the Investment Risk and Data Warehousing teams, followed by additional weeks waiting for the fix to be made at the source. A pre-build data validation step would have surfaced this gap before any dashboard work began.


## Related Knowledge

Companion pre-build lenses (read together at session kickoff):
- Discovery-First Authoring — inventory the workbook's real state before building: `expertise://tableau/personalization/discovery-first-authoring`
- Frame the Question — what the dashboard must answer, and what a dashboard can credibly give: `expertise://tableau/personalization/frame-the-question-before-building`

## Source and Confidence

- Source/evidence type: field-tested, customer-safe example
- Source: rchand — personal field experience across financial services and enterprise analytics engagements
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-12
