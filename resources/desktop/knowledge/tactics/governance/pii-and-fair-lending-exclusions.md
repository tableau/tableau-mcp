# PII and Fair Lending Field Exclusions

SE knowledge entry for field expertise that may later be reviewed for promotion into the Tableau authoring expertise layer.

## Scope Check

- Primary audience: SE assisting a Tableau user
- Authoring outcome improved: govern, safely decline
- In-scope reason: Defines which data fields must be excluded from Tableau dashboards and underlying datasets for PII and fair lending compliance, and how to catch these at the consultation and peer review stages before a dashboard reaches production.
- Out-of-scope risk: broad security architecture, sales process
- Tags: governance, PII, fair-lending, compliance, data-source, financial-services, when-to-say-no
- Relevant user prompts/search terms: "exclude PII from Tableau dashboard", "fair lending field rules", "cannot include customer names addresses", "FICO score sortable task list", "cherry-pick loan files compliance risk", "Tableau dashboard access controls gap", "remove sensitive fields from dataset", "consultation gate before build peer review"

## When to Use

Use this guidance when a customer requests a dashboard that includes any of the following:

- Customer names, addresses, phone numbers, or email addresses
- FICO scores, credit scores, or loan amounts
- Any personally identifiable information (PII) about end customers
- Any field that would allow users to rank, sort, or prioritize records by a protected or sensitive attribute

This applies to:

- Financial services customers (lending, banking, mortgage, insurance)
- Any organization where Tableau dashboards do not inherit the access controls of the source operating system
- All dashboard types — operational, inspection, and management performance

## Best Practices

### The Core Principle

Tableau dashboards do not inherit the security and access controls of the operating system they companion. A user who has access to a Tableau dashboard may not have the same access rights as a user of the underlying loan origination system, CRM, or operational platform. This gap creates real exposure when sensitive fields are included — even if they appear to be controlled at the viz level.

**The only safe position is to exclude sensitive fields from the dataset entirely** — not to filter them out in the viz, not to hide them in the workbook, but to never include them in the extract or data source.

Anything in the underlying data can be exported: through Tableau's built-in export, through downloaded crosstabs, or by a developer querying the data source directly. If the field is in the data, it is potentially exposed.

### Fields to Exclude — PII

Never include the following in a Tableau dataset or dashboard:

- Customer first or last names
- Property or mailing addresses
- Phone numbers
- Email addresses
- Government-issued ID numbers (SSN, EIN, etc.)
- Any other field that uniquely identifies or locates a specific individual

### Fields to Exclude — Fair Lending

Never include the following in a Tableau dataset or dashboard where users work queues or task lists:

- FICO or credit scores
- Loan amounts or application amounts
- Any field that enables a user to sort or rank tasks by a financially sensitive or protected attribute

**Why this matters:** A sortable table of open loan files that includes FICO scores or loan amounts allows users to cherry-pick — to work only the highest-score or highest-value files first. This constitutes unfair lending practice and creates regulatory exposure for the organization. The field itself creates the risk, regardless of intent.

### When to Say No

Say no when a customer requests any PII or fair-lending-sensitive field be included in a dashboard dataset or visualization.

Recommended wording:

> Including that field in this dashboard creates a compliance risk we need to avoid. Tableau dashboards don't inherit the access controls of your operating system — loan origination system, CRM, or servicing platform — so a user with dashboard access could see or export data they wouldn't have access to in the system of record. We recommend excluding this field from the dataset entirely — not just hiding it in the viz — so it cannot be exported or accessed downstream.

For fair lending fields specifically:

> Including loan amounts or FICO scores in a sortable task table would allow users to prioritize files by those values, which is an unfair lending practice. We exclude those fields from the dataset entirely so they cannot be surfaced, sorted, or exported through Tableau.

Offer this instead:

- Substitute anonymized or bucketed identifiers (loan ID, case number, file reference) that allow task tracking without exposing PII
- Use days-based priority fields (days since last contact, days until closing) for task prioritization instead of financial attribute fields
- If a business need requires seeing sensitive details, direct the user to the operating system where access controls are properly enforced

### Escalation

If a business stakeholder pushes back and insists the fields are necessary, escalate to a lead analyst, compliance officer, or legal/risk team before including the fields. Do not include sensitive fields pending escalation.

## Common Mistakes

- **Hiding a sensitive field in the workbook instead of removing it from the dataset.** A hidden field is still in the underlying data and can be exported. Exclusion must happen at the data source level.
- **Assuming viz-level security is sufficient.** Row-level security and filtered views do not prevent data export by authorized users. The field must not exist in the dataset.
- **Treating this as a financial-services-only rule.** Any organization where Tableau access does not mirror operating system access has this exposure. The principle applies broadly.
- **Waiting for peer review to catch it.** Peer review is a confirmation gate, not the primary catch. The consultation stage — when the BI analyst reviews the request — is where this should be identified and resolved before any work begins.
- **Adding loan amount or FICO as a non-visible sort field.** Even a sort-only field in the underlying data can be exported. Exclusion is the only safe option.

## Implementation

This is a two-gate governance model:

**Gate 1 — Consultation (before build):**

1. Review the dashboard request for sensitive field inclusions.
2. If PII or fair-lending fields are requested, advise the business user that those fields cannot be included and explain why.
3. Agree on approved substitute fields (e.g., anonymized IDs, days-based priority fields) before the dashboard is designed.
4. Document the field exclusion decision in the request record.

**Gate 2 — Peer Review (before production):**

1. Reviewer checks the original request, the dataset, the dashboard, and the UT test results together.
2. Confirms that no PII or fair-lending-sensitive fields appear in the dataset, the viz, or the exported data.
3. Confirms the guiding principle was followed end-to-end.
4. Dashboard does not go to production until this review is complete.

## Source and Confidence

- Source: mschley — field-tested governance model managing 500–700 Tableau dashboards at a major US bank; applied to all dashboard types across the portfolio
- Source/evidence type: SE field experience
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-01
