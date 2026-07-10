# Operational and Pipeline Dashboard Pattern

SE knowledge entry for field expertise that may later be reviewed for promotion into the Tableau authoring expertise layer.

## Scope Check

- Primary audience: SE assisting a Tableau user
- Authoring outcome improved: create, format, govern, safely decline
- In-scope reason: Defines the layout, column selection framework, companion principle, and scope boundaries for operational/pipeline dashboards — the most action-oriented dashboard type — so Claude can guide users building task queues and work-management views correctly.
- Out-of-scope risk: none
- Tags: dashboard, operational, pipeline, task-queue, companion, layout, column-selection, when-to-say-no
- Relevant user prompts/search terms: "what columns should I show in my task list", "how to build a work queue dashboard", "case management dashboard layout", "loan pipeline view", "what to include in an operations dashboard", "users need to see their work queue", "show tasks that need to be done", "pipeline or queue dashboard pattern", "should I put action buttons in Tableau", "too many columns on my task table"

## When to Use

Use this guidance when a customer is building a dashboard whose primary purpose is to show users **what tasks need to be done** — a work queue, pipeline view, case list, or activity log where the viewer is expected to act, not just observe.

This applies to:

- Loan processing, underwriting, or servicing queues
- Case management or compliance task lists
- Sales pipeline or opportunity management views
- Any dashboard where the user opens it to find out what to work on next

## Best Practices

### The Companion Principle

An operational dashboard is a **companion to the operating system, not a substitute for it.**

The dashboard tells the user what to do and gives them just enough context to prioritize. The actual work — updating records, completing tasks, changing statuses — happens in the operating system (loan origination system, CRM, ticketing platform, etc.) open in another tab or window.

This principle defines the entire scope of the dashboard and is the correct answer to almost every "can we add X" request. If X belongs in the operating system, it does not belong in the dashboard.

### Standard Layout

```
┌─────────────────────────────────────────────┐
│  Header + subtitle + contact + data currency │
├──────────┬──────────────────────────────────┤
│ Record   │                                  │
│ count    │                                  │
│ + time   │   Task / Work Queue Table        │
│ context  │   (relevant columns only)        │
│          │                                  │
│ Filters  │                                  │
│          │                                  │
└──────────┴──────────────────────────────────┘
```

**Left panel (always visible):**
- At the top: a single count showing how many records are currently displayed, with time context (e.g., "47 items due today", "12 files outstanding this week")
- Below the count: all filters needed to work the queue

**Main canvas:**
- A detail table listing all tasks or pipeline items
- Relevant columns only — nothing extra

### Column Selection: The Bare Minimum Test

Before adding any column to the task table, ask the business user:

> What is the bare minimum you need to complete this task, or to prioritize it against other items on the screen?

Include a column only if it passes one of these tests:

1. **Directs the user to the task** — a record ID, case number, or reference that lets them find and open the right item in the operating system
2. **Enables prioritization** — time-based fields like days since last contact, days until closing date, or days in current status
3. **Surfaces information that is hard to see in the operating system on the same screen** — fields the operating system buries in sub-screens or requires navigation to find

Exclude everything else. If the operating system shows it clearly, the dashboard does not need to duplicate it.

### When to Say No

Say no when users ask to add columns, filters, or features that push the dashboard beyond its role as a companion.

**Common requests to decline:**

- **Additional fields "just to have them"** — every extra column competes for screen space and dilutes focus. Hold the line on bare minimum.
- **PII fields** (names, addresses, phone numbers, emails) — Tableau does not inherit operating system access controls; see `pii-and-fair-lending-exclusions.md`.
- **Financially sensitive fields** (FICO scores, loan amounts) — enables cherry-picking and creates fair lending exposure; see `pii-and-fair-lending-exclusions.md`.
- **Action buttons or status update controls** — if users want to mark tasks complete or update records from within Tableau, redirect them to the operating system. Tableau is not the system of record.
- **Embedded operating system screens or iframes** — the dashboard is a companion, not a portal into the OS.

Recommended wording for scope creep:

> This dashboard is designed to tell your team what to work on and help them prioritize. The actual work happens in your operating system — the loan origination system, CRM, or ticketing platform. Adding that feature would turn the dashboard into a second operating system, which creates maintenance overhead and access control complexity we want to avoid. Let's keep this focused on what needs doing and let your operating system handle the doing.

## Common Mistakes

- **Including too many columns.** A 15-column task table overwhelms users and defeats the prioritization purpose. Apply the bare minimum test ruthlessly — 5–8 columns is typically the right range.
- **No record count or time context.** Without a count and time context, users don't know if they're looking at today's queue, this week's backlog, or everything since the beginning of time. The count above the filters is essential.
- **Filters separated from the task table.** If filters live at the top of a long page and the task table is below the fold, users have to scroll up to filter and scroll down to see results. Keep filters left-side and adjacent to the table — or put the detail on its own tab with filters proximate.
- **Trying to replace the operating system.** Adding update buttons, status dropdowns, or action controls turns the dashboard into a UI — which it is not designed or governed to be.
- **Including sensitive fields in the dataset.** Anything in the underlying data can be exported. Exclusion happens at the data source level, not the viz level.

## Implementation

To build an operational/pipeline dashboard:

1. **Define the record set** with the business user: what population of tasks or items should appear, and over what time window (today, this week, all open items)?
2. **Apply the bare minimum test** to agree on columns before building. Get sign-off on the column list before any development starts.
3. **Exclude sensitive fields from the dataset** (PII, FICO scores, loan amounts) at the data source level — not via filters or hidden fields.
4. **Build the layout:**
   - Left panel: record count + time context label at top, filters below
   - Main canvas: task table with approved columns only
   - Apply the filter threshold rule from `dashboard-template-anatomy.md` (≤10 filters visible, 10+ collapsible floating panel)
5. **Include all standard template elements** from `dashboard-template-anatomy.md`: header, subtitle, help contact, and data currency (refreshed as of + current as of).
6. **Route through peer review** before production. Reviewer confirms column list matches the approved bare minimum, sensitive fields are absent from the dataset, and template elements are complete.

## Source and Confidence

- Source: mschley — field-tested managing 500–700 Tableau dashboards at a major US bank; operational dashboards were the most common type in the portfolio
- Source/evidence type: SE field experience
- Customer-identifying details removed: yes
- Confidence: field-tested
- Last reviewed: 2026-06-01
