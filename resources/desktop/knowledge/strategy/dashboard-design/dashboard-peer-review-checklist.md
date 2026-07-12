# Dashboard Peer Review Checklist

SE knowledge entry for field expertise that may later be reviewed for promotion into the Tableau authoring expertise layer.

## Scope Check

- Primary audience: SE assisting a Tableau user
- Authoring outcome improved: validate, govern, safely decline
- In-scope reason: Defines the field-tested peer review checklist used to gate dashboards before production — so Claude can guide authors to self-review correctly and help SEs conduct structured reviews that catch the most common authoring and governance failures.
- Out-of-scope risk: none
- Tags: peer-review, governance, quality-gate, filters, tooltips, naming, worksheet-hygiene, row-limiter, data-classification, publishing
- Relevant user prompts/search terms: "how do I review a dashboard before publishing", "pre-production checklist", "what to check before going live", "dashboard quality gate", "peer review failing", "template elements missing", "filters breaking when data changes", "all in list vs all"

## When to Use

Use this guidance when:

- An author is preparing a dashboard for peer review or production publishing
- An SE is conducting or structuring a dashboard review
- A customer asks what quality standards a dashboard should meet before going live
- Claude is asked to validate or critique a dashboard's readiness

This applies to:

- Enterprise teams with a governed dashboard publishing process
- Any Tableau dashboard being published to Tableau Server or Tableau Cloud
- All dashboard types: operational, inspection, and management performance

## Best Practices

A peer review is a gate, not a suggestion. The dashboard does not go to production until every check passes.

### 1. Story Check

Verify the dashboard actually answers the question or request it was built for. The dashboard should tell a clear, focused story — not overwhelm the viewer with information. If the dashboard cannot be summarized in one sentence, it is doing too much.

Ask: "Does this dashboard answer the original business question? Would a viewer know what to do or think after looking at it for 10 seconds?"

### 2. Template and Brand Standards

Confirm all six required template elements are present and correctly populated:

1. Header (common font, optional business unit branding)
2. Subtitle / context block (what, why, who — must be complete, not a placeholder)
3. Help contact (email or support form)
4. Data currency — two distinct fields: refreshed as of + current as of
5. Data classification label (near data currency, not in a footer)
6. Filter panel (≤10 visible left panel, 10+ collapsible with icon button)

Also check:
- Fonts are consistent with portfolio standards
- Colors are used to make a point, not for decoration
- Style guidelines and branding are followed

### 3. Tooltip Quality

Review every tooltip on every viz. A good tooltip:

- Is simple and to the point — not a data dump
- Shows the category or dimension (what slice of data is this?)
- Shows a single primary metric
- **If showing a percentage: always includes the numerator, denominator, and the percentage** — never the percentage alone

Tooltips are commonly treated as an afterthought. Peer review should ensure they add to the data story rather than appearing as an annoying or confusing pop-up.

### 4. Mobile Compatibility

If mobile is a requirement for the use case, verify the dashboard translates well to a mobile layout. Check at mobile resolution before approving.

### 5. Interactivity Testing

Test every interactive element end-to-end:

- All buttons function correctly
- URL actions open the correct destination
- View as Filter works as expected and applies across the intended vizzes
- Dashboard actions (filter actions, highlight actions) behave correctly across all target worksheets

Do not assume interactivity works because it was set up correctly — test it.

### 6. Filter Validation

Check every filter on the dashboard:

**Applied correctly:**
- Each filter applies to the correct worksheets (usually all sheets on the same dashboard tab)
- Confirm scope is intentional — not accidentally limited to a single sheet

**Future-proofed for new data:**
- Use **"All"** (dynamic), never **"All in list"** — "All in list" is a static snapshot of dimension members at build time and breaks when new values enter the data
- Date filters must use **relative date ranges** (last 30 days, last quarter, year to date) — never a hardcoded start/end date. A hardcoded date range returns no data once time moves past it, leaving users with a blank dashboard and no explanation

**Filter UI best practice:**
- Multi-select dropdown list
- Explicit "All" option
- "Apply" button so users can make all selections before the dashboard refreshes

### 7. Data Pane Hygiene

Review the Data pane of every worksheet:

**Field naming:**
- All field aliases must match the standardized logical names of the database (e.g., "Loan Number" everywhere — not `loan_nbr`, `LN_NUM`, or a developer's custom label)
- The same field must have the same name across every dashboard that uses the same data source
- Calculated fields should follow the same naming conventions as the base fields — they should feel like they belong in the same family

**Unused fields:**
- Remove all fields not used in the workbook before publishing
- Unused fields clutter the Data pane, confuse maintainers, and may expose data that should not be visible

### 8. Worksheet Hygiene

- Every worksheet must have a clear, concise, human-readable name — not "Sheet 1," "Sheet 4," or a developer abbreviation
- Worksheets should be color-coded as a visual grouping aid (sheets feeding related dashboards use the same color). Use general grouping, not strict tab-matching, since a sheet may appear on multiple dashboard tabs
- Remove all unused worksheets — if a sheet is not used on any dashboard, it should not be in the workbook

### 9. Row Limiter for Tabular Dashboards

For any dashboard containing a grid or tabular view, apply the row limiter pattern to prevent users from loading and exporting unbounded row counts.

**Why it matters:** Financial services users commonly export dashboard data to Excel. A user exporting 100,000 rows is likely doing work that should be done in the dashboard itself. The row limiter creates a natural boundary and opens a conversation about what they actually need.

**Implementation:**
- **Parameter**: "Number of Records Shown" — expose to users, either in the left filter panel or top-right above the grid. Default value on open: 1,000. Additional values: 10,000, 25,000, 50,000, 100,000
- **Calculated field**: `INDEX()` — hidden field placed on the leftmost shelf of Rows; this sequences every row in the table
- **Filter**: A table calculation filter on the worksheet using: `INDEX() <= [Number of Records Shown]`

The parameter is visible to users so they can increase the row count intentionally — but the default of 1,000 keeps the initial load fast and signals that larger exports should be questioned.

### 10. Publishing and Access Checks

Before publishing to Tableau Server or Tableau Cloud:

**Classification vs. permissions alignment:**
- Confirm the dashboard's data classification label (Internal Use Only, Confidential, Restricted) matches the Tableau Server permission group the dashboard will be published to
- A "Confidential" label on a dashboard published to an all-staff group is a governance failure — the label and the access must agree

**Business access rules:**
- Verify that the permission groups granted access do not inadvertently expose data to users who should not have it under business rules — not just Tableau rules
- This is distinct from Tableau's permission model: a group may have technical access to a dashboard while business policy says they should not see that data
- When in doubt, verify with your data steward, compliance officer, or Tableau administrator before publishing

## When to Say No

Say no when a dashboard fails any check and the author wants to publish anyway.

Recommended wording:

> Peer review is a gate, not a suggestion. Publishing a dashboard that fails a check creates a support burden, a trust problem, or a compliance risk that is much harder to fix after users have seen it. Let's resolve the issue now — it is almost always faster than dealing with it after publish.

Common situations requiring a hard stop before publish:

- Subtitle is blank or contains placeholder text
- Data classification label is missing or does not match the Server permissions group
- Filters use "All in list" or a hardcoded date range
- PII or fair-lending-sensitive fields are present in the dataset

## Common Mistakes

- **Treating peer review as optional or a formality.** It is a production gate. A dashboard that has not been reviewed should not be published.
- **Reviewing only the visuals, not the data.** The most impactful failures — hardcoded date filters, "All in list" members, incorrect filter scope, unused fields — are invisible until the data changes or time passes.
- **Skipping interactivity testing.** Filter actions and URL actions frequently break when sheets are renamed or data sources are swapped. Test every one.
- **Not checking tooltips.** Tooltips are almost always an afterthought. An unformatted tooltip that dumps all fields onto the viewer erodes trust in the dashboard.
- **Approving with known issues "to fix later."** Issues noted in review but not resolved before publish rarely get fixed. The review gate exists specifically to prevent this.

## Implementation

Suggested review sequence:

1. Open the original dashboard request alongside the finished dashboard
2. Run the story check first — if the dashboard doesn't answer the question, the detailed checks don't matter yet
3. Work through template, tooltip, and brand checks visually
4. Switch to the Data pane and worksheets for naming and hygiene checks
5. Test every filter — change values, confirm scope, verify no "All in list" or hardcoded dates
6. Test all buttons, actions, and interactive elements end-to-end
7. For tabular dashboards, verify the row limiter parameter and INDEX filter are in place
8. Run the mobile check if applicable
9. Before approving publish: confirm classification label matches Server permissions group and verify business access rules with the appropriate stakeholder

## Source and Confidence

- Source: mschley — field-tested peer review process managing 500–700 Tableau dashboards at a major US bank; all dashboards required passing this review before production
- Source/evidence type: SE field experience
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-04
