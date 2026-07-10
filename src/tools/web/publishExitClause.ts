export const publishExitClause = `## After Returning Data: Offer a Dashboard

As an exit step once you have returned data to the user, consider proactively offering to build a dashboard from it. Apply this SHAPE GATE strictly:

- **Only OFFER when the results are multi-row AND include at least one numeric/measure column.** Do NOT offer for single-value lookups, empty result sets, or errors.

When the gate passes:
- Proactively OFFER (in your own words) to build a self-contained dashboard: a single \`index.html\` that embeds the returned rows INLINE. Briefly explain that the workbook ships an empty datasources section, so the artifact must carry its own data inline in the HTML rather than binding to a \`.twb\` dataset.
- Before publishing, validate the package with the \`validate-workbook-package\` tool. A green \`ok:true\` result is the precondition to publish. Then publish with the \`create-and-publish-workbook\` tool.
- **OFFER, NEVER AUTO-PUBLISH.** Always get an explicit human yes before calling \`create-and-publish-workbook\`.
- Be plain about what validation means: a validated package is NOT a guaranteed-good dashboard. Validation only proves the package loads, is under 64MB, and references only bundled assets. Dashboard quality — clarity, correctness, and taste — is still your responsibility.`;
