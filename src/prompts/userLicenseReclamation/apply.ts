import { z } from 'zod';

import { renderConfirmInstructions, renderHitlGate } from '../_lib/confirm.js';
import { WebPromptFactory } from '../registry.js';

const LIST_USERS_TOOL = 'list-users';
const ADMIN_INSIGHTS_TOOL = 'query-admin-insights';
const UPDATE_USER_TOOL = 'update-user';

const argsSchema = {
  inactiveDays: z
    .string()
    .regex(/^[1-9]\d*$/, 'inactiveDays must be a positive integer')
    .optional()
    .describe(
      'Minimum days since last login for a user to be considered inactive. Defaults to 90.',
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
        'When omitted, all licensed roles (Creator, Explorer, Viewer) are in scope.',
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

const DEFAULT_INACTIVE_DAYS = 90;

const LICENSED_ROLES = ['Creator', 'Explorer', 'ExplorerCanPublish', 'Viewer'] as const;

const TS_EVENTS_FIELDS = ['Actor User ID', 'Actor User Name', 'Event Type', 'Event Created At'];

const SITE_CONTENT_FIELDS = [
  'Item Type',
  'Item Name',
  'Owner Email',
  'Owner LUID',
  'Item Parent Project Name',
];

const buildActivityQuery = (inactiveDays: number): Record<string, unknown> => ({
  kind: 'ts-events',
  query: {
    fields: TS_EVENTS_FIELDS.map((fieldCaption) => ({ fieldCaption })),
    filters: [
      {
        field: { fieldCaption: 'Event Type' },
        filterType: 'SET',
        values: ['Login', 'Login (Embedded)'],
        exclude: false,
      },
      {
        field: { fieldCaption: 'Event Created At' },
        filterType: 'DATE',
        periodType: 'DAYS',
        dateRangeType: 'LASTN',
        rangeN: inactiveDays,
      },
    ],
  },
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
      ? parseInt(args.inactiveDays, 10)
      : DEFAULT_INACTIVE_DAYS;

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
    const scopeRoles = suppliedRoles.length > 0 ? suppliedRoles : [...LICENSED_ROLES];

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
      ...(userIds.length > 0
        ? [
            'After the call returns, narrow the working set client-side to the user IDs listed in **Scope** above. ' +
              'If any requested ID is missing from the inventory, list it under "Missing users" in the final report and skip it.',
          ]
        : []),
      '',
      `**Step 2 — Activity signals (read-only).** Call \`${ADMIN_INSIGHTS_TOOL}\` exactly once with the arguments below ` +
        "to retrieve login events. Use these to determine each user's most recent login date.",
      '',
      '```json',
      JSON.stringify(buildActivityQuery(inactiveDays), null, 2),
      '```',
      '',
      'The query returns rows of login events within the lookback window. For each user from Step 1, ' +
        'find their most recent `Event Created At` among the returned rows (matching on `Actor User ID`). ' +
        `A user is considered inactive if they have NO login row in the result (meaning no login within ${inactiveDays} days), ` +
        'or if they were absent from Step 1 results entirely (never logged in).',
      '',
      `**Step 3 — Ownership inventory (read-only).** Call \`${ADMIN_INSIGHTS_TOOL}\` exactly once with the arguments below ` +
        'to retrieve content ownership data.',
      '',
      '```json',
      JSON.stringify(buildOwnershipQuery(), null, 2),
      '```',
      '',
      'For each inactive user identified in Step 2, count how many workbooks and data sources they own ' +
        '(matching on `Owner LUID` from the Site Content rows against the user LUID from Step 1). ' +
        'This is informational — ownership is NOT affected by downgrade. ' +
        'Present the owned-content count per user so the admin can decide whether to reassign ownership ' +
        'separately before or after reclamation.',
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
