import { z } from 'zod';

import { WebPromptFactory } from '../registry.js';

export const LICENSE_RECLAIM_INACTIVE_DAYS_DEFAULT = 90;
export const LICENSE_RECLAIM_ROLES_DEFAULT = ['Creator', 'Explorer'];

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
    .regex(/^[1-9]\d*$/, 'inactiveDays must be a positive integer')
    .optional()
    .describe(
      'Minimum days of inactivity before a user is considered a reclamation candidate. ' +
        `Defaults to ${LICENSE_RECLAIM_INACTIVE_DAYS_DEFAULT}. ` +
        'Bounded by Admin Insights TS Events 90-day lookback window unless Advanced Management is enabled.',
    ),
  roles: z
    .string()
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

    const listUsersFilter = `siteRole:in:${roles.join('|')},lastLogin:lt:${cutoffIso}`;

    const tsEventsQuery = {
      fields: [
        { fieldCaption: 'Actor User Id' },
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
          field: { fieldCaption: 'Created At' },
          filterType: 'DATE',
          periodType: 'DAYS',
          dateRangeType: 'LASTN',
          rangeN: inactiveDays,
        },
      ],
    };

    const text = [
      'You are running the Tableau MCP **user-license-reclamation-inform** workflow against the connected Tableau Cloud site.',
      '',
      '## Step 1 — Fetch candidate users',
      '',
      'Call `list-users` to retrieve all users matching the reclamation criteria. The tool auto-paginates. Use the following filter:',
      '',
      '```json',
      JSON.stringify({ filter: listUsersFilter }, null, 2),
      '```',
      '',
      `This returns users with site roles [${roles.join(', ')}] whose \`lastLogin\` is before ${cutoffIso} (inactive ≥ ${inactiveDays} days).`,
      '',
      '## Step 2 — Cross-reference recent activity',
      '',
      'Call `query-admin-insights` with `kind: "ts-events"` to look for recent Access events by these users:',
      '',
      '```json',
      JSON.stringify({ kind: 'ts-events', query: tsEventsQuery }, null, 2),
      '```',
      '',
      'Group the TS Events results by `Actor User Id` to determine if any candidate user has accessed content within the lookback window. Users with recent Access events should be excluded from the final candidate list — they are active despite a stale `lastLogin` timestamp.',
      '',
      '## Step 3 — Render the report',
      '',
      '1. Print a header line: `License reclamation candidates (threshold = <inactiveDays> days, roles = [<roles>], total candidates = <count>)`.',
      '2. Render the final candidates (those NOT seen in TS Events) as a Markdown table with columns: `User Name | Email | Site Role | Last Login | Days Inactive | Auth Setting`.',
      '   - Sort by Days Inactive descending.',
      '   - Days Inactive = number of days between now and their `lastLogin`.',
      '3. If no candidates remain after the TS Events cross-reference, state: "No reclamation candidates found above the threshold." and stop.',
      '4. Below the table, append the following fixed notes:',
      '   - Recommendation: These users are candidates for downgrade to **Unlicensed**. Review the list and confirm before taking action.',
      '   - Note: TS Events caps at 90 days lookback on Tableau Cloud (365 days with Advanced Management). Users inactive longer than the lookback window may have been active earlier than records suggest.',
      '   - Note: `lastLogin` reflects Tableau UI sign-in only — API-only or embedded users may show as inactive despite usage.',
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
