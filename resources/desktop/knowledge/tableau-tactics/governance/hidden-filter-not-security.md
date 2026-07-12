# Hidden Workbook Filters Are Not Row-Level Security

Guidance for safely declining a common unsafe request: "hide restricted rows with a hidden workbook filter so certain users can't see them." A hidden or workbook-level filter is a presentation choice, not an access control, and must not be used to enforce who can see which data.

---

## When to Use This Module

Use this guidance when a user asks to use a **filter** - especially a *hidden* one - to keep some viewers from seeing certain rows. Examples include "hide restricted customers so executives can't see them" or "filter out the rows that group X shouldn't see."

This applies to:

- Any "make a filter act as access control" request
- Dashboards intended for audiences with different data-access rights
- Requests to "hide" sensitive rows at the workbook layer

---

## Core Boundary

A workbook or hidden filter only changes what a view *displays by default*. It does not remove the data from the workbook or extract, and it does not stop a viewer from reaching it through duplicating or editing the sheet, Web Edit, Download, View Data, or a new viz against the same source.

Because the data remains reachable, a hidden or workbook-level filter cannot enforce who may see which rows.

---

## Governed Alternatives

Redirect the user to governed row-level security:

- **User filters / entitlements**: row-level security driven by the viewer's identity, such as `USERNAME()` or `ISMEMBEROF()`, ideally via an entitlements table joined to the data and applied as a **data source filter** on a **published data source** so the rule travels with the data.
- **Permissions on a published data source / workbook** to control who can connect or see content.
- **Security at the data layer** such as database RLS, secure views, or extract-time filtering tied to identity when the rule must be enforced regardless of client.

Keep the answer in workbook and data-source terms. Do not turn it into a broad enterprise security architecture engagement unless the entitlements model itself needs a security owner.

---

## When to Say No

Say no when a filter, hidden or visible, is being used as the mechanism that enforces who may see which rows.

Recommended wording:

> A hidden workbook filter changes what the view shows by default, but it does not secure the data. Anyone who can open the workbook can still reach the filtered-out rows. To actually restrict who sees which rows, use governed row-level security - a user-filter / entitlements rule applied to a published data source, or security enforced at the data source - backed by permissions. I can help you set that up instead.

Offer this instead:

- Row-level security via a user filter / entitlements table on a published data source
- Permissions on the published data source / workbook
- Row-level security enforced at the database or extract layer

---

## Best Practices

- **Name the boundary plainly.** A workbook or hidden filter only changes what the view displays by default; it does not secure the underlying data.
- **Redirect to governed RLS.** Use published data source filters tied to identity, entitlements, permissions, or data-layer security.
- **Keep it an authoring decision.** Explain the safe path in workbook/data-source terms rather than designing enterprise security.
- **Validate by not implementing the unsafe path.** Do not apply a workbook change that adds a hidden or row-hiding filter presented as access control.

---

## Common Mistakes

1. **Treating a hidden or workbook-level filter as access control.** It only changes the default display.
2. **Building a "works for the demo" workbook-only workaround and implying it controls access.**
3. **Escalating into broad enterprise security architecture instead of giving the governed authoring answer.**
4. **Assuming "hidden" means "inaccessible."** Web Edit, Download, duplicate-sheet, and View Data all bypass it.

---

## Implementation

1. Acknowledge the goal: certain viewers should not see certain rows.
2. State the constraint clearly: a hidden/workbook filter is not a security control; the data is still present and reachable.
3. Explain why the shortcut is unsafe: duplicate/edit sheet, Web Edit, Download, and View Data can expose the rows.
4. Offer the governed alternative: row-level security via user filter / entitlements on a published data source, plus permissions; or security at the data layer.
5. Do not apply a workbook change that simulates access control with a hidden filter. Escalate to data/security ownership when the entitlements model needs to be defined.

---

## Source and Confidence

- Source/evidence type: internal-doc
- Source: consolidated Tableau authoring governance guidance (hidden filter vs row-level security)
- Customer-identifying details removed: yes
- Confidence: needs review
- Last reviewed: 2026-06-04
