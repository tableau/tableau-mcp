import { z } from 'zod';

import { WebPromptFactory } from '../registry.js';

export const LICENSE_RECLAIM_INACTIVE_DAYS_DEFAULT = 90;
export const LICENSE_RECLAIM_ROLES_DEFAULT = ['Creator', 'Explorer'];

// TS Events lookback cap on Tableau Cloud (365 with Advanced Management).
const TS_EVENTS_LOOKBACK_MAX_DAYS = 90;

function getConfiguredInactiveDays(): number {
  const raw = process.env.LICENSE_RECLAIM_INACTIVE_DAYS;
  if (!raw) return LICENSE_RECLAIM_INACTIVE_DAYS_DEFAULT;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1 || n > 3650) return LICENSE_RECLAIM_INACTIVE_DAYS_DEFAULT;
  return n;
}

function getConfiguredRoles(): string[] {
  const raw = process.env.LICENSE_RECLAIM_ROLES;
  if (!raw) return LICENSE_RECLAIM_ROLES_DEFAULT;
  const roles = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return roles.length > 0 ? roles : LICENSE_RECLAIM_ROLES_DEFAULT;
}

const argsSchema = {
  inactiveDays: z
    .string()
    .regex(/^[1-9]\d{0,3}$/, 'inactiveDays must be a positive integer (1–3650)')
    .optional()
    .describe(
      'Minimum days of inactivity before a user is considered a reclamation candidate. ' +
        `Defaults to ${LICENSE_RECLAIM_INACTIVE_DAYS_DEFAULT}. Clamped to 1–3650. ` +
        'Bounded by Admin Insights TS Events 90-day lookback window unless Advanced Management is enabled.',
    ),
  roles: z
    .string()
    .regex(/^[A-Za-z, ]+$/, 'roles must contain only letters, commas, and spaces')
    .optional()
    .describe(
      'Comma-separated list of site roles to target for reclamation ' +
        `(e.g. "Creator,Explorer"). Defaults to "${LICENSE_RECLAIM_ROLES_DEFAULT.join(',')}".`,
    ),
} as const;

export const getUserLicenseReclamationInformPrompt: WebPromptFactory = () => ({
  name: 'user-license-reclamation-inform',
  title: 'User license reclamation — generate inform report',
  description:
    'Tableau Cloud admin workflow: identify inactive licensed users who are candidates for ' +
    'downgrade to Unlicensed. Paginates the `list-users` tool with role/lastLogin filters, ' +
    'cross-references activity via `query-admin-insights` (kind: "ts-events"), and renders ' +
    'a candidate list. Read-only — no user modifications are performed.',
  argsSchema,
  disabled: (config) => !config.adminToolsEnabled,
  callback: (args) => {
    const inactiveDays = args.inactiveDays
      ? parseInt(args.inactiveDays, 10)
      : getConfiguredInactiveDays();

    const roles = args.roles
      ? args.roles
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : getConfiguredRoles();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);
    const cutoffIso = cutoffDate.toISOString();

    // Cap the TS Events lookback to the platform maximum — querying beyond
    // it returns no additional data and would cause false positives.
    const activityLookbackDays = Math.min(inactiveDays, TS_EVENTS_LOOKBACK_MAX_DAYS);

    const listUsersFilter = `siteRole:in:${roles.join('|')},lastLogin:lt:${cutoffIso}`;

    // Field captions verified against live TS Events VDS schema (2026-07-19).
    // `Actor User Name` is a STRING matching the user's Tableau username (email).
    // `Event Date` is DATETIME (UTC) — NOT `Created At` which doesn't exist on TS Events.
    const tsEventsQuery = {
      fields: [
        { fieldCaption: 'Actor User Name' },
        { fieldCaption: 'Item Type' },
        { fieldCaption: 'Item Name' },
      ],
      filters: [
        {
          field: { fieldCaption: 'Event Type' },
          filterType: 'SET',
          values: ['Access'],
          exclude: false,
        },
        {
          field: { fieldCaption: 'Event Date' },
          filterType: 'DATE',
          periodType: 'DAYS',
          dateRangeType: 'LASTN',
          rangeN: activityLookbackDays,
        },
      ],
    };

    const text = [
      'You are running the Tableau MCP **user-license-reclamation-inform** workflow against the connected Tableau Cloud site.',
      '',
      '## Step 1 — Fetch candidate users',
      '',
      'Call `list-users` to retrieve users matching the reclamation criteria. The tool paginates automatically (subject to any configured `MAX_RESULT_LIMIT`). Use the following filter:',
      '',
      '```json',
      JSON.stringify({ filter: listUsersFilter }, null, 2),
      '```',
      '',
      `This returns users with site roles [${roles.join(', ')}] whose \`lastLogin\` is before ${cutoffIso} (inactive ≥ ${inactiveDays} days).`,
      '',
      'Then call `list-users` a second time with the same `siteRole` filter but **without** the `lastLogin` filter, and include only users whose `lastLogin` is empty/null (never signed in). These are also reclamation candidates — licensed users who were provisioned but never logged in.',
      '',
      '## Step 2 — Cross-reference recent activity',
      '',
      'Call `query-admin-insights` with `kind: "ts-events"` to look for recent Access events by these users:',
      '',
      '```json',
      JSON.stringify({ kind: 'ts-events', query: tsEventsQuery, limit: 10000 }, null, 2),
      '```',
      '',
      `Group the TS Events results by \`Actor User Name\` to determine if any candidate user has accessed content within the ${activityLookbackDays}-day lookback window. Match \`Actor User Name\` against the candidate's \`name\` or \`email\` field from Step 1. Users with recent Access events should be excluded from the final candidate list — they are active despite a stale \`lastLogin\` timestamp.`,
      '',
      '## Step 3 — Render the report',
      '',
      '1. Print a header line: `License reclamation candidates (threshold = <inactiveDays> days, roles = [<roles>], total candidates = <count>)`.',
      '2. Render the final candidates (those NOT seen in TS Events) as a Markdown table with columns: `User Name | Email | Site Role | Last Login | Days Inactive | Auth Setting`.',
      '   - Sort by Days Inactive descending. Users with null `lastLogin` (never signed in) go at the top with Days Inactive = "Never".',
      '   - Days Inactive = number of days between now and their `lastLogin`, or "Never" if null.',
      '3. If no candidates remain after the TS Events cross-reference, state: "No reclamation candidates found above the threshold." and stop.',
      '4. Below the table, append the following fixed notes:',
      '   - Recommendation: These users are candidates for downgrade to **Unlicensed**. This is an INFORM-only report — review the list with a human before taking any action.',
      '   - Note: TS Events caps at 90 days lookback on Tableau Cloud (365 days with Advanced Management). Users inactive longer than the lookback window may have been active earlier than records suggest.',
      '   - Note: TS Events data is subject to ETL lag (typically 24–48h). A user who accessed content very recently may not yet appear in TS Events — treat candidates as provisional, not definitive.',
      '   - Note: `lastLogin` reflects Tableau UI sign-in only — API-only, embedded, or PAT-authenticated users may show as inactive despite usage. The TS Events cross-reference partially compensates but is not exhaustive due to ETL lag.',
      '   - Note: This report is read-only. No user modifications, notifications, or role changes are performed.',
    ].join('\n');

    return {
      messages: [
        {
          role: 'user',
          content: { type: 'text', text },
        },
      ],
    };
  },
});
