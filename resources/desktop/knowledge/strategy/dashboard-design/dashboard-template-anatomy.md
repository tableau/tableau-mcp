# Dashboard Template Anatomy

SE knowledge entry for field expertise that may later be reviewed for promotion into the Tableau authoring expertise layer.

## Scope Check

- Primary audience: SE assisting a Tableau user
- Authoring outcome improved: create, format, govern
- In-scope reason: Defines the required structural elements of a standard Tableau dashboard template so Claude can guide users building new dashboards or auditing existing ones against a field-tested enterprise baseline.
- Out-of-scope risk: none
- Tags: dashboard, template, layout, header, data-currency, data-classification, filters, governance, enterprise
- Relevant user prompts/search terms: "what should every dashboard include", "how do I standardize dashboards", "required dashboard elements", "where do I put data freshness", "data classification label placement", "how many filters before collapsing", "what goes in a dashboard header"

## When to Use

Use this guidance when a customer is:

- Building a new Tableau dashboard and has not defined a structural template yet
- Asking how to standardize dashboards across a team, workgroup, or business unit
- Auditing existing dashboards for consistency and completeness
- Asking where to put filters, titles, contact info, or data freshness indicators

This applies to:

- Enterprise teams managing more than a handful of dashboards
- Any Tableau user who wants dashboards to feel consistent and professional
- SEs building demo dashboards or guiding a customer POC

## Best Practices

### Reading Order: Upper-Left to Lower-Right

Place the most important content in the upper-left and the least important content in the lower-right. The eye follows a natural Z-pattern or F-pattern across a dashboard — work with that flow, not against it. See `dashboard-layout-patterns.md` for full layout pattern guidance.

### Required Template Elements

Every dashboard in a governed portfolio should include all of the following:

#### 1. Header

- Common font, consistent across all dashboards in the portfolio
- Optionally branded to a specific business unit or domain
- Should appear at the top of every dashboard — never omit it

#### 2. Subtitle / Context Block

A 2–3 sentence block immediately below or within the header that answers:

- **What** this dashboard shows
- **Why** it exists (the business question it answers)
- **Who** the primary users are

This is the most commonly skipped element and the most important one for governance. Without it, dashboards become orphaned and unmaintainable.

#### 3. Help Contact

An email address or link to a support form so users know who to contact with questions or data issues. This prevents support requests from going to the wrong team and builds trust with dashboard consumers.

#### 4. Data Currency — Two Distinct Indicators

Include **both** of the following, clearly labeled:

- **Refreshed as of**: When the ETL or data extract last ran (pipeline timestamp)
- **Current as of**: What time period the data actually covers (business date of the data)

These two values are often different and must not be conflated. A pipeline can run at 6am today but the data it loaded may only be current through yesterday's close. Showing only one misleads users about what they are looking at.

#### 5. Data Classification Label

A visible label indicating the information classification of the dashboard's data, placed **near the data currency indicators** in the header zone — never in a footer.

Common classification levels (institution-defined):

- **Internal Use Only** — visible to employees, not for external distribution
- **Confidential** — restricted to specific roles or teams
- **Restricted** — highest sensitivity, tightly controlled access

The label is primarily a visual signal for the consumer, but it carries a governance obligation: the peer review must confirm that the classification label matches the actual access controls on the dashboard. A "Confidential" label on a broadly accessible dashboard is a compliance failure.

**Why not the footer:** Footer labels get lost when the dashboard canvas is taller than the screen or when scroll position varies. Placing the classification label near the data currency ensures it is always visible in the header area regardless of canvas size or scroll.

#### 6. Filter Panel

Apply the following threshold rule:

| Filter count | Placement |
|---|---|
| ~10 or fewer | Left-side panel, always visible |
| More than 10 | Floating panel, toggled by a filter icon button |

For the floating panel pattern:
- Use a Tableau button object with a filter icon image
- Wire the button to show/hide the floating filter panel
- The panel should float over the dashboard content, not push the layout
- The icon provides a familiar affordance — users know what it means

### When to Say No

Say no when a customer wants to skip the template elements to "save time" or asks Claude to build a dashboard without a subtitle, data currency indicators, a classification label, or a help contact.

Recommended wording:

> These elements take minutes to add and prevent months of confusion. A dashboard without a subtitle becomes unmaintainable — no one will know what it does or who owns it six months from now. Let's add them now while we're building.

Offer this instead:

- A pre-built shared template workbook that pre-loads all required elements as placeholders so the author just fills them in
- A checklist the author can run through before publishing

## Common Mistakes

- **Skipping the subtitle.** Without the context block, no one knows what a dashboard is for six months after it was built. Peer review should catch this before production.
- **Using a single data freshness field.** Showing "Last Updated: Today 6:02am" when the data covers through yesterday misleads users about timeliness. Always show both refresh time and data coverage period separately.
- **Inconsistent fonts and headers across dashboards.** When every dashboard looks slightly different, users perceive the reporting platform as unreliable. Standardize the header in a template and require its use.
- **No help contact.** Data questions and issues have nowhere to go, eroding trust in the dashboard. A single email address or support link costs almost nothing to add.
- **Putting 10+ filters in a visible sidebar.** A visible panel with many filters competes with the content for attention and clutters the layout. Use the threshold rule to decide when to collapse filters behind a button.
- **Placing the data classification label in the footer.** Footer labels disappear when the dashboard canvas is taller than the screen. Field-tested lesson: move the classification label to the header zone near the data currency indicators so it is always visible.
- **Mismatched classification label and access controls.** A label that says "Confidential" on a dashboard accessible to all employees is a governance failure. Peer review must confirm the label and the actual Tableau Server/Cloud permissions align.

## Implementation

To apply this template when building a new dashboard:

1. Start from a shared Tableau workbook template file (`.twbx`) that pre-loads the header, subtitle placeholder, contact object, data currency fields, and classification label.
2. Fill in the subtitle context block (what, why, who) before adding any charts.
3. Add the data currency fields as calculated fields or as a text object pulled from a metadata extract — one for refresh timestamp, one for data-as-of date.
4. Add the data classification label as a text object in the header zone, adjacent to the data currency indicators. Apply the correct classification level per your institution's data governance policy.
5. Decide on filter count and apply the threshold rule (≤10 visible left panel, 10+ collapsible floating panel).
6. Route the dashboard through peer review before publishing to production. The peer reviewer should confirm all six template elements are present, the subtitle is complete, and the classification label matches the actual access controls on the published dashboard.

For enforcing this in an existing portfolio:
- Audit dashboards against the six required elements
- Prioritize adding the subtitle/context block, data currency, and classification label to high-traffic dashboards first
- Build the template elements into a shared layout container that authors can copy into any workbook

## Source and Confidence

- Source: mschley — field-tested managing 500–700 Tableau dashboards at a major US bank; governed portfolio with peer review gate before production
- Source/evidence type: SE field experience
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-01
