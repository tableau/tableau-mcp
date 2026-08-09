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
    'cross-references activity via `query-admin-insights` (kinds "ts-events" for content-access ' +
    'events and "ts-users" for Tableau Desktop/Prep last-access dates), and renders a candidate ' +
    'list. Read-only — no user modifications are performed.',
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

    // A single `lastLogin:lt` filter already captures never-signed-in users:
    // `list-users` treats an undefined `lastLogin` as matching `lt`/`lte` (see
    // usersFilterUtils `matchesFilter`), so they come back as the most-inactive
    // candidates. Do NOT add a second `list-users` call to fetch null-`lastLogin`
    // users separately — it would re-return the same rows and inflate the
    // rendered "total candidates" count (double-count).
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

    // Field captions verified against the official Admin Insights TS Users data dictionary
    // (help.tableau.com adminview_insights_users). TS Users uses PLAIN, unprefixed user captions
    // — `User Email` / `User Name` — NOT the `Actor User Name` caption that is specific to TS
    // Events. `Tableau Desktop - Last Access Date` / `Tableau Prep - Last Access Date` are UTC
    // DATETIMEs (there are separate `... (Local)` variants — use the UTC captions here). No date
    // filter is applied: these are one-row-per-user last-access timestamps, so we fetch them and
    // compare against the cutoff client-side (null = no signal, NOT activity — see Step 3).
    //
    // Scope to the Step-1 candidate emails via a SET filter on `User Email`: an UNfiltered query
    // on a large tenant (e.g. 27k users) would be silently truncated to an arbitrary 10000-user
    // slice, dropping a Desktop-active candidate's row → "null = no signal" → false candidate.
    // The `values` array is a render-time placeholder the model replaces with the Step-1 emails.
    const tsUsersEmailPlaceholder =
      '<REPLACE with the candidate User Emails from Step 1 — one string per candidate>';
    const tsUsersQuery = {
      fields: [
        { fieldCaption: 'User Email' },
        { fieldCaption: 'User Name' },
        { fieldCaption: 'Tableau Desktop - Last Access Date' },
        { fieldCaption: 'Tableau Prep - Last Access Date' },
      ],
      filters: [
        {
          field: { fieldCaption: 'User Email' },
          filterType: 'SET',
          values: [tsUsersEmailPlaceholder],
          exclude: false,
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
      'This single call **also** includes users who have never signed in (empty/null `lastLogin`): the `lastLogin:lt` filter treats them as the most-inactive candidates. Do not issue a second `list-users` call for them — they are already in these results. Render never-signed-in users with Days Inactive = "Never".',
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
      '## Step 3 — Cross-reference Tableau Desktop / Prep activity',
      '',
      'TS Events and `lastLogin` only capture web sign-in and server-content access — neither reflects Tableau **Desktop** or **Prep** usage. Call `query-admin-insights` with `kind: "ts-users"` to retrieve per-user Desktop/Prep last-access dates:',
      '',
      "**Scope this query to the Step-1 candidates.** Before issuing the call, replace the `User Email` filter's `values` placeholder below with the exact list of candidate `email` values from Step 1 (one string per candidate). This SET filter bounds the response to the candidate set, so the 10000-row cap cannot silently drop a Desktop-active candidate and turn them into a false positive. Do not fetch all site users.",
      '',
      '```json',
      JSON.stringify({ kind: 'ts-users', query: tsUsersQuery, limit: 10000 }, null, 2),
      '```',
      '',
      `Match each row to a candidate by \`User Email\` (against the candidate's \`email\`) or \`User Name\` (against the candidate's \`name\`). A candidate is **active** — and must be excluded from the final list — if either \`Tableau Desktop - Last Access Date\` OR \`Tableau Prep - Last Access Date\` is **non-null AND on or after ${cutoffIso}** (i.e. within the last ${inactiveDays} days).`,
      '',
      'If the TS Users query returns exactly 10000 rows, warn that results were truncated at the 10000-row limit: some candidates may be missing their Desktop/Prep last-access date and could be falsely listed as inactive — narrow the scope with a smaller role set or candidate list. (With the `User Email` scoping above this should not occur unless the candidate set itself exceeds 10000.)',
      '',
      '**Null handling — null is NOT activity.** A `null`, empty, or missing Desktop/Prep date is NOT evidence of activity: the user REMAINS a candidate. Only a recent *non-null* Desktop/Prep date rescues a user. (Many tenants do not collect Desktop/Prep telemetry, in which case these fields are null for every user — see the caveat note in Step 4.)',
      '',
      '## Step 4 — Render the report',
      '',
      '1. Print a header line: `License reclamation candidates (threshold = <inactiveDays> days, roles = [<roles>], total candidates = <count>)`.',
      '2. Render the final candidates (those NOT excluded by the Step 2 TS Events cross-reference AND NOT excluded by the Step 3 Desktop/Prep cross-reference) as a Markdown table with columns: `User Name | Email | Site Role | Last Login | Days Inactive`.',
      '   - Sort by Days Inactive descending. Users with null `lastLogin` (never signed in) go at the top with Days Inactive = "Never".',
      '   - Days Inactive = number of days between now and their `lastLogin`, or "Never" if null.',
      '3. If no candidates remain after both cross-references, state: "No reclamation candidates found above the threshold." and stop.',
      '4. Below the table, append the following fixed notes:',
      '   - Recommendation: These users are candidates for downgrade to **Unlicensed**. This is an INFORM-only report — review the list with a human before taking any action.',
      '   - Note: TS Events caps at 90 days lookback on Tableau Cloud (365 days with Advanced Management). Users inactive longer than the lookback window may have been active earlier than records suggest.',
      '   - Note: TS Events data is subject to ETL lag (typically 24–48h). A user who accessed content very recently may not yet appear in TS Events — treat candidates as provisional, not definitive.',
      '   - Note: `lastLogin` reflects Tableau UI sign-in only — API-only, embedded, or PAT-authenticated users may show as inactive despite usage. The TS Events cross-reference partially compensates but is not exhaustive due to ETL lag.',
      '   - Note: Tableau Desktop / Prep last-access dates (Step 3) are populated only when the tenant collects Desktop/Prep telemetry. On tenants where this data is unavailable these fields are null for every user, so the Desktop/Prep cross-reference excludes no one — a null date is treated as "no signal", NOT as activity. If every candidate has null Desktop and Prep dates, note that Desktop/Prep activity data may be unavailable on this tenant and the candidate list could include users who are active only in Desktop/Prep.',
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
