import { z } from 'zod';

import { renderConfirmInstructions, renderHitlGate } from '../_lib/confirm.js';
import { WebPromptFactory } from '../registry.js';

const LIST_USERS_TOOL = 'list-users';
const ADMIN_INSIGHTS_TOOL = 'query-admin-insights';
const UPDATE_USER_TOOL = 'update-user';

// TS Events lookback cap on Tableau Cloud (365 with Advanced Management).
const TS_EVENTS_LOOKBACK_MAX_DAYS = 90;

const LICENSE_RECLAIM_INACTIVE_DAYS_DEFAULT = 90;

// Full set of license-consuming roles on Tableau Cloud.
// Exact-match filters using only base names (e.g. "Creator") miss compound roles
// like "SiteAdministratorCreator" — include all variants for zero-config UX.
const LICENSE_RECLAIM_ROLES_DEFAULT = [
  'Creator',
  'Explorer',
  'ExplorerCanPublish',
  'SiteAdministratorCreator',
  'SiteAdministratorExplorer',
  'Viewer',
];

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
    .regex(/^(?:[1-9]\d{0,2}|[12]\d{3}|3[0-5]\d{2}|36[0-4]\d|3650)$/, 'inactiveDays must be a positive integer (1–3650)')
    .optional()
    .describe(
      'Minimum days since last login for a user to be considered inactive. ' +
        `Defaults to ${LICENSE_RECLAIM_INACTIVE_DAYS_DEFAULT}. ` +
        'Bounded by Admin Insights TS Events 90-day lookback window unless Advanced Management is enabled.',
    ),
  siteRoles: z
    .string()
    .regex(
      /^[A-Za-z0-9, -]+$/,
      'siteRoles must contain only letters, numbers, commas, spaces, and dashes',
    )
    .optional()
    .describe(
      'Optional comma-separated list of site roles to scope reclamation to (e.g. "Viewer, Explorer"). ' +
        'When omitted, all license-consuming roles are in scope (Creator, Explorer, ExplorerCanPublish, ' +
        'SiteAdministratorCreator, SiteAdministratorExplorer, Viewer).',
    ),
  userIds: z
    .string()
    .regex(
      /^[A-Za-z0-9, -]+$/,
      'userIds must contain only letters, numbers, commas, spaces, and dashes',
    )
    .optional()
    .describe(
      'Optional comma-separated list of user LUIDs to scope the reclamation to. ' +
        'When omitted, all inactive users matching the criteria are analyzed.',
    ),
  dryRun: z
    .enum(['true', 'false'])
    .optional()
    .describe(
      'When "true" (default), produce only the reclamation report — do not call ' +
        `\`${UPDATE_USER_TOOL}\`. Set to "false" to allow the apply step ` +
        'after the human-in-the-loop confirmation.',
    ),
} as const;

// Field captions verified against live TS Events VDS schema (2026-07-19).
// `Actor User Name` is a STRING matching the user's Tableau username (email).
// `Event Date` is DATETIME (UTC) — NOT `Created At` which doesn't exist on TS Events.
const TS_EVENTS_FIELDS = ['Actor User Name', 'Event Type', 'Event Date'];

// Site Content verified captions — `Owner LUID` does NOT exist on this datasource;
// join on `Owner Email` against the user email from Step 1.
const SITE_CONTENT_FIELDS = ['Item Type', 'Item Name', 'Owner Email', 'Item Parent Project Name'];

const buildActivityQuery = (inactiveDays: number): Record<string, unknown> => ({
  kind: 'ts-events',
  query: {
    fields: TS_EVENTS_FIELDS.map((fieldCaption) => ({ fieldCaption })),
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
        rangeN: Math.min(inactiveDays, TS_EVENTS_LOOKBACK_MAX_DAYS),
      },
    ],
  },
  limit: 10000,
});

const buildOwnershipQuery = (): Record<string, unknown> => ({
  kind: 'site-content',
  query: {
    fields: SITE_CONTENT_FIELDS.map((fieldCaption) => ({ fieldCaption })),
    filters: [
      {
        field: { fieldCaption: 'Item Type' },
        filterType: 'SET',
        values: ['Workbook', 'Datasource'],
        exclude: false,
      },
    ],
  },
  limit: 10000,
});

export const getUserLicenseReclamationApplyPrompt: WebPromptFactory = () => ({
  name: 'user-license-reclamation-apply',
  title: 'User license reclamation — downgrade inactive users to Unlicensed',
  description:
    'Tableau Cloud admin workflow (destructive Apply phase): identify inactive licensed users ' +
    'via `list-users` and `query-admin-insights` (kind: ts-events), present candidates with ' +
    'owned-content counts, and — only after a required human-in-the-loop approval — downgrade ' +
    `approved users to Unlicensed via \`${UPDATE_USER_TOOL}\`. Admin-only. ` +
    'Ownership of content is retained after downgrade (no content is deleted).',
  argsSchema,
  disabled: (config) => !config.adminToolsEnabled,
  callback: (args) => {
    const dryRun = args.dryRun !== 'false';
    const inactiveDays = args.inactiveDays
      ? Math.min(parseInt(args.inactiveDays, 10), 3650)
      : getConfiguredInactiveDays();

    const suppliedRoles: string[] = args.siteRoles
      ? Array.from(
          new Set(
            args.siteRoles
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean),
          ),
        )
      : [];
    const scopeRoles = suppliedRoles.length > 0 ? suppliedRoles : getConfiguredRoles();

    const userIds: string[] = args.userIds
      ? Array.from(
          new Set(
            args.userIds
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean),
          ),
        )
      : [];

    const activityLookbackDays = Math.min(inactiveDays, TS_EVENTS_LOOKBACK_MAX_DAYS);

    const userIdScope =
      userIds.length > 0
        ? `the following user IDs only: ${userIds.map((id: string) => `\`${id}\``).join(', ')}`
        : 'every inactive licensed user matching the criteria';

    const hitlGate = renderHitlGate({
      actionVerb: 'downgrade',
      actionGerund: 'downgrade',
      itemNounSingular: 'user',
      itemNounPlural: 'users',
      presentColumns: [
        'Username',
        'Display Name',
        'Current Site Role',
        'Last Login',
        'Days Inactive',
        'Owned Workbooks',
        'Owned Datasources',
      ],
    });

    const confirmInstructions = renderConfirmInstructions({
      toolRef: `\`${UPDATE_USER_TOOL}\``,
      itemNoun: 'user',
      gateKind: 'token',
    });

    const modeLine = dryRun
      ? `\`dryRun = true\` — report only. Do **not** call \`${UPDATE_USER_TOOL}\` under any circumstance.`
      : '`dryRun = false` — apply step is permitted **only after** the human confirms in Step 4.';

    const text = [
      'You are running the Tableau MCP **user-license-reclamation-apply** workflow against the connected Tableau Cloud site.',
      'This is a DESTRUCTIVE admin workflow. Follow every step in order and never skip the human-confirmation break.',
      `CRITICAL: Steps 1-3 are READ-ONLY. Make NO \`${UPDATE_USER_TOOL}\` call until the user has ` +
        'explicitly approved a specific set of users at the Step 4 human-confirmation break.',
      '',
      `**Mode:** ${modeLine}`,
      `**Scope:** ${userIdScope}.`,
      `**Inactive threshold:** ${inactiveDays} days.`,
      `**Site roles in scope:** ${scopeRoles.join(', ')}.`,
      '',
      `**Step 1 — User inventory (read-only).** Call \`${LIST_USERS_TOOL}\` to retrieve all users on the site. ` +
        'Filter client-side to users whose `siteRole` is one of the roles in scope above ' +
        'and who hold a licensed role (i.e. not already Unlicensed or ServerAdministrator).',
      'Users whose `lastLogin` is null (never signed in) are also candidates — they were ' +
        'provisioned but never used their license. Include them with Days Inactive = "Never".',
      ...(userIds.length > 0
        ? [
            'After the call returns, narrow the working set client-side to the user IDs listed in **Scope** above. ' +
              'If any requested ID is missing from the inventory, list it under "Missing users" in the final report and skip it.',
          ]
        : []),
      '',
      `**Step 2 — Activity signals (read-only).** Call \`${ADMIN_INSIGHTS_TOOL}\` exactly once with the arguments below ` +
        `to retrieve access events within the ${activityLookbackDays}-day lookback window.`,
      '',
      '```json',
      JSON.stringify(buildActivityQuery(inactiveDays), null, 2),
      '```',
      '',
      'Group the results by `Actor User Name` to determine if any candidate user has accessed content ' +
        `within the ${activityLookbackDays}-day lookback window. Match \`Actor User Name\` against the candidate's ` +
        '`name` or `email` field from Step 1.',
      '',
      '**Inactivity determination (both conditions must hold):**',
      `- The user's \`lastLogin\` from Step 1 is either **null** (never signed in) OR older than ${inactiveDays} days ago, AND`,
      `- The user has NO \`Access\` event in the TS Events result within the ${activityLookbackDays}-day lookback window.`,
      '',
      `Users whose \`lastLogin\` is within the last ${inactiveDays} days are NOT candidates, even if they have no Access event ` +
        '(the absence may be due to ETL lag or non-content activity). Exclude them from the inactive set.',
      '',
      `If the query returns exactly ${10000} rows, warn the admin: "⚠️ TS Events results were truncated at the ` +
        `${10000}-row limit. Some active users may not appear in the result — candidates are not exhaustive. ` +
        'Consider narrowing the scope with `userIds` or reducing `inactiveDays`."',
      '',
      `Note: TS Events caps at ${TS_EVENTS_LOOKBACK_MAX_DAYS} days lookback on standard Tableau Cloud ` +
        '(365 days with Advanced Management). Users inactive longer than the lookback window may have ' +
        'been active earlier than records suggest — treat candidates as provisional.',
      'Note: TS Events data is subject to ETL lag (typically 24–48h). A user who accessed content very ' +
        'recently may not yet appear in TS Events.',
      '',
      `**Step 3 — Ownership inventory (read-only).** Call \`${ADMIN_INSIGHTS_TOOL}\` exactly once with the arguments below ` +
        'to retrieve content ownership data.',
      '',
      '```json',
      JSON.stringify(buildOwnershipQuery(), null, 2),
      '```',
      '',
      'For each inactive user identified in Step 2, count how many workbooks and data sources they own ' +
        '(matching `Owner Email` from the Site Content rows against the user `email` from Step 1). ' +
        'This is informational — ownership is NOT affected by downgrade. ' +
        'Present the owned-content count per user so the admin can decide whether to reassign ownership ' +
        'separately before or after reclamation.',
      `If the query returns exactly ${10000} rows, note in the report: "⚠️ Site Content results were ` +
        `truncated at the ${10000}-row limit — owned-content counts may be understated for some users."`,
      '',
      '**IMPORTANT — Ownership note:** Downgrading a user to Unlicensed does NOT delete, reassign, ' +
        'or affect any content they own. Their workbooks, data sources, and other content remain ' +
        'published and owned by them. If the admin wants to reassign ownership, that is a separate ' +
        'action outside this workflow.',
      '',
      '**Step 4 — ' + (dryRun ? 'STOP (dry run).' : 'Human confirmation break.') + '**',
      hitlGate,
      '',
      'Present the inactive users as a Markdown table and ask: "Downgrade these N users from their ' +
        'current site role to Unlicensed? Reply `yes` to proceed, `no` to abort, or list specific ' +
        'usernames/IDs to apply selectively."',
      '',
      `Do NOT call \`${UPDATE_USER_TOOL}\` without the user's explicit approval in this turn. ` +
        'A previous approval does NOT carry forward. If the user replies with anything other than ' +
        '`yes` or a non-empty list of users, stop and report "Aborted by user".',
      '',
      ...(dryRun
        ? [
            "**Because `dryRun = true`, stop here regardless of the user's reply.** Print the table " +
              'from Step 3 plus a one-line note: `Dry run — no changes applied. Re-run with dryRun = false to apply.`',
          ]
        : [
            '**Step 5 — Preview (per approved user, read-only).** ONLY for the users the user explicitly approved above, ' +
              `call \`${UPDATE_USER_TOOL}\` with \`{ userId: <luid>, siteRole: "Unlicensed" }\` and \`confirm\` omitted. ` +
              'The tool validates the downgrade is possible and returns a per-user `confirmationToken` without ' +
              "calling the Tableau update endpoint. Keep each user's `confirmationToken`.",
            '- Do **not** parallelize. Wait for each preview to complete before the next. Nothing is updated in this step.',
            '',
            '**Step 6 — Apply (confirmed).**',
            confirmInstructions,
            '',
            `- For each approved user: call \`${UPDATE_USER_TOOL}\` again with ` +
              '`{ userId: <luid>, siteRole: "Unlicensed", confirm: true, confirmationToken: <the token Step 5 returned for this user> }`.',
            '- Do **not** parallelize. Wait for each call to complete before the next.',
            '- If a single call returns an error, stop immediately, record the failure, and report the partial state ' +
              'in the final report — do **not** continue with the remaining changes.',
          ]),
      '',
      `**Step ${dryRun ? 5 : 7} — Final report.** Print:`,
      '- A "Changes applied" section with one bullet per user touched: `Username — downgraded from <old role> to Unlicensed — <success | error: <code/message>>`.',
      '- A "Skipped" section listing any users the admin excluded or who were already Unlicensed.',
      ...(userIds.length > 0
        ? [
            '- A "Missing users" section listing any requested user IDs that were not found in the inventory.',
          ]
        : []),
      '- An "Ownership reminder" section: for every downgraded user who owns content, list the count ' +
        'and remind the admin that ownership can be reassigned separately if needed.',
      '',
      '**Fixed notes**',
      '- No user is downgraded until the admin approves a specific user set at the Step 4 break.',
      '- This workflow only downgrades users the admin explicitly approved; unapproved users are never touched.',
      '- Downgrading to Unlicensed does NOT delete or reassign content — ownership is retained.',
      `- \`${UPDATE_USER_TOOL}\` is reversible by re-assigning the user's prior site role.`,
      '- Admin-only, Tableau Cloud. Users the admin excluded or that are missing from the inventory are never touched.',
      `- TS Events lookback is ${TS_EVENTS_LOOKBACK_MAX_DAYS} days on standard Tableau Cloud. ` +
        'Data is subject to 24–48h ETL lag — candidates are provisional, not definitive.',
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
