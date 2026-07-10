# Hidden Workbook Filters Are Not Row-Level Security

Guidance for safely declining a common unsafe request: "hide restricted rows with a hidden workbook filter so certain users can't see them." A hidden or workbook-level filter is a presentation choice, not an access control, and must not be used to enforce who can see which data.

## Scope Check

- Primary audience: SE assisting a Tableau user
- Authoring outcome improved: safely decline, govern
- In-scope reason: Helps Claude refuse an unsafe authoring shortcut and redirect to governed Tableau security mechanisms, framed as a workbook authoring decision.
- Out-of-scope risk: broad security architecture (keep the answer to the authoring decision, not enterprise security design)
- Tags: security, row-level-security, rls, filters, governance, safe-refusal, when-to-say-no
- Expected agent behavior: Decline to implement a hidden filter as access control; explain it is not a security mechanism; redirect to governed row-level security; do not apply a workbook change that simulates access control.
- Relevant user prompts/search terms: "hide restricted rows with a filter", "row level access control via filter", "filter so users cannot see certain rows", "use hidden filter for security", "hide data from users with workbook filter", "restrict rows using dashboard filter", "hide rows so they can't see", "hidden filter for security", "restrict by filter", "executives shouldn't see", "filter out sensitive rows"
- Suggested golden task: User asks to hide restricted rows from some viewers using a hidden workbook filter.
- Safe refusal condition: when a filter (hidden or otherwise) is requested as the mechanism that enforces who may see which rows.

## When to Use

Use this guidance when a user asks to use a **filter** — especially a *hidden* one — to keep some viewers from seeing certain rows (for example, "hide restricted customers so executives can't see them," "filter out the rows that group X shouldn't see").

This applies to:

- Any "make a filter act as access control" request
- Dashboards intended for audiences with different data-access rights
- Requests to "hide" sensitive rows at the workbook layer

## Best Practices

- **Name the boundary plainly.** A workbook or hidden filter only changes what a view *displays by default*. It does not remove the data from the workbook/extract and does not stop a viewer from reaching it (duplicating or editing the sheet, Web Edit, Download, "View Data," or a new viz against the same source). So it cannot enforce who may see which rows.
- **Redirect to governed row-level security (RLS):**
  - **User filters / entitlements**: row-level security driven by the viewer's identity (e.g. `USERNAME()`, `ISMEMBEROF()`), ideally via an entitlements table joined to the data, applied as a **data source filter** on a **published data source** so the rule travels with the data.
  - **Permissions on a published data source / workbook** to control who can connect or see content.
  - **Security at the data layer** (database RLS, secure views, or extract-time filtering tied to identity) when the rule must be enforced regardless of client.
- **Keep it an authoring decision.** Explain the safe path in workbook/data-source terms; do not turn it into an enterprise security-architecture engagement.
- **Validate by not implementing the unsafe path.** Do not apply a workbook change that adds a hidden/row-hiding filter presented as access control.

### When to Say No

Say no when a filter (hidden or visible) is being used as the mechanism that enforces who may see which rows.

Recommended wording:

> A hidden workbook filter changes what the view shows by default, but it does not secure the data — anyone who can open the workbook can still reach the filtered-out rows. To actually restrict who sees which rows, use governed row-level security (a user-filter / entitlements rule applied to a published data source, or security enforced at the data source), backed by permissions. I can help you set that up instead.

Offer this instead:

- Row-level security via a user filter / entitlements table on a published data source
- Permissions on the published data source / workbook
- Row-level security enforced at the database or extract layer

## Common Mistakes

- Treating a hidden or workbook-level filter as if it enforces access — it only changes the default display.
- Building a "works for the demo" workbook-only workaround and implying it controls access.
- Escalating into broad enterprise security architecture instead of giving the governed authoring answer.
- Assuming "hidden" means "inaccessible" — Web Edit, Download, duplicate-sheet, and View Data all bypass it.

## Implementation

1. Acknowledge the goal: certain viewers should not see certain rows.
2. State the constraint clearly: a hidden/workbook filter is not a security control; the data is still present and reachable.
3. Explain why the shortcut is unsafe (duplicate/edit sheet, Web Edit, Download, View Data all expose the rows).
4. Offer the governed alternative: row-level security via user filter / entitlements on a published data source, plus permissions; or security at the data layer.
5. Do not apply a workbook change that simulates access control with a hidden filter. Escalate to data/security ownership when the entitlements model needs to be defined.

## Related Knowledge

- Core governance guidance: do not simulate row-level security with hidden workbook filters; redirect to governed security mechanisms. This entry is that guidance.
- Relates to [Filters in Tableau](data/knowledge/strategy/viz-design/filter-strategy.md): explains filter behavior generally; this entry is specifically about not using filters as access control.

## Source and Confidence

- Source/evidence type: internal-doc
- Source: consolidated Tableau authoring governance guidance (hidden filter vs row-level security)
- Customer-identifying details removed: yes
- Confidence: needs review
- Last reviewed: 2026-06-04
