/**
 * Builds the MCP server `instructions` string returned once at `initialize`. The host injects this
 * into the model's context every session, so it stays terse: a whole-server orientation plus, when
 * the admin tools are enabled, an intent map for `query-admin-insights`'s `kind` values.
 *
 * The admin-insights section is appended only when `adminToolsEnabled` so hosts without the admin
 * tools don't carry guidance for a tool they never see. Kept in one place so every server variant
 * (web, combined) emits identical instructions.
 */

const ORIENTATION = `\
Tableau MCP provides tools to explore and query a Tableau site's content, users, jobs, and published data.

To answer questions about the data inside a published datasource, follow the grounding pattern: (1) discover the datasource with \`list-datasources\` or \`search-content\`; (2) ground on its schema with \`get-datasource-metadata\` to get exact field names; (3) query it with \`query-datasource\`. Always ground before querying — never guess field names.`;

const ADMIN_INSIGHTS = `\
\`query-admin-insights\` answers questions about the site itself via Admin Insights (Tableau Cloud, site administrators only). Pick \`kind\` by what the user is asking about:
- \`ts-events\`: audit-event history — access, publish, update, and delete events over time. Use for "who did what, when" activity trails.
- \`ts-users\`: per-user signals — last login, days since last login, and Tableau Desktop / Prep / Web Authoring last-access dates. Use for user activity, inactive users, and license reclamation.
- \`site-content\`: content inventory — workbook and datasource metadata, ownership, and size. Use for "what content exists and who owns it".
- \`job-performance\`: extract-refresh and subscription execution history. Use for refresh and subscription reliability and performance.
- \`stale-content\`: unused-content report (items past a last-access threshold). Use for cleanup and archival; pass \`minAgeDays\` / \`projectIds\` / \`itemTypes\`, not a \`query\`.`;

export function buildServerInstructions({
  adminToolsEnabled,
}: {
  adminToolsEnabled: boolean;
}): string {
  return adminToolsEnabled ? `${ORIENTATION}\n\n${ADMIN_INSIGHTS}` : ORIENTATION;
}
