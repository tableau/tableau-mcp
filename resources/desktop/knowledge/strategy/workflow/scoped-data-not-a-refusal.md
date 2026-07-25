# Scoped Data Is Not a Missing-Field Refusal

## Scope Check

- Primary audience: Tableau agent / SE handling an authoring request whose wording names a scoping relationship absent from the datasource
- Authoring outcome improved: build the requested view when the datasource is plausibly pre-scoped, while preserving refusal for unsupported subset selection
- In-scope reason: Distinguishes a missing scope label from missing data needed to answer the question.
- Out-of-scope risk: This does not permit inventing fields, values, relationships, or filters.
- Tags: scoped-data, pre-filtered-data, missing-field, safe-refusal, assumption, manager, team, region, owner, bind-template
- Expected agent behavior: Build over the full datasource only when its entity grain and columns plausibly show that it already contains the requested entities; state that assumption in one line.
- Safe refusal condition: Refuse or ask when honoring the request requires selecting a subset that no available field can identify.

## When to Use

Use this when an ask names a scoping relationship—such as manager, team, region, or owner—but no field expresses that relationship. Apply the testable discriminator: if the datasource is small and entity-grained, and its columns describe the asked-about entities such that it plausibly contains only that scope, build over all rows and state the assumption.

If the datasource may contain a broader population and the missing field is required to select the requested subset, refuse or ask. Building over every row would silently answer a different question.

## Best Practices

- Inventory the fields and grain before deciding that a named relationship is a missing required column.
- State the assumption in one line: "Assuming this datasource is already scoped to Southard's reports."
- Use every row only when the datasource itself plausibly represents the complete requested scope.
- Keep the no-fabrication rule: never create a manager, team, region, owner, or other column merely to satisfy the wording.

## Common Mistakes

- Treating every noun absent from the schema as an unconditional stop sign.
- Applying this carve-out to a broad datasource when the request needs an unidentifiable subset.
- Building silently without disclosing the pre-scoped-data assumption.
- Inventing a scope field or value; fabricating a column remains forbidden.

## Implementation

1. List the available fields and identify the datasource grain and apparent population.
2. Decide whether the missing relationship only describes the datasource's existing scope or is needed to select rows.
3. If it only describes a plausible existing scope, build over all rows and state the assumption.
4. If it is needed to select rows, refuse or ask for a field, filter, or already-scoped datasource that can identify the subset.

### Worked Example

Ask: "Build me a Tableau map of the office locations of the PMs reporting to Southard." The datasource has six rows and exactly `pm_name`, `city`, `latitude`, and `longitude`. That small entity-grained shape plausibly contains only Southard's reports, so say "Assuming this datasource is already scoped to Southard's reports," then call `bind-template` once: spatial-symbol-map-latlon binds longitude to Columns, latitude to Rows, and `pm_name` plus `city` to Detail.

Counter-example: "Show sales in the West region" over a national datasource with no region field. Region is required to select a subset, so refuse or ask for a region field or a West-scoped datasource; using all national rows would answer a different question.

## Source and Confidence

- Source/evidence type: live eval diagnosis plus binder regression evidence
- Source: s7 office-map eval and spatial-symbol-map-latlon live path, 2026-07-25
- Customer-identifying details removed: yes
- Confidence: field-observed
- Last reviewed: 2026-07-25
