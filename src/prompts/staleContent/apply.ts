import { z } from 'zod';

import { STALE_CONTENT_MIN_AGE_DAYS_DEFAULT } from '../../overridableConfig.js';
import { renderConfirmInstructions, renderHitlGate } from '../_lib/confirm.js';
import { WebPromptFactory } from '../registry.js';

const DEFAULT_PENDING_DELETION_TAG = 'pending-deletion';

/**
 * Content-type registry — the genericity mechanism. Each stale-content item type maps to the read
 * tool that resolves its LUID and the two-phase delete tool that tags/deletes it. New content types
 * (e.g. flows) plug in by adding a row plus their delete tool — the workflow text below is written
 * against this table, so no prompt rewrite is needed.
 *
 * Keys match the `itemType` values emitted by get-stale-content-report (and its `itemTypes` arg).
 */
const CONTENT_TYPE_REGISTRY = {
  Workbook: { listTool: 'list-workbooks', deleteTool: 'delete-workbook', idArg: 'workbookId' },
  Datasource: {
    listTool: 'list-datasources',
    deleteTool: 'delete-datasource',
    idArg: 'datasourceId',
  },
} as const;

type ContentType = keyof typeof CONTENT_TYPE_REGISTRY;

const ALL_CONTENT_TYPES = Object.keys(CONTENT_TYPE_REGISTRY) as ContentType[];

function isContentType(value: string): value is ContentType {
  return value in CONTENT_TYPE_REGISTRY;
}

const argsSchema = {
  minAgeDays: z
    .string()
    .regex(/^\d+$/, 'minAgeDays must be a positive integer')
    .optional()
    .describe(
      'Minimum days since last access for content to be considered stale. Defaults to the ' +
        `server-configured threshold (default ${STALE_CONTENT_MIN_AGE_DAYS_DEFAULT}).`,
    ),
  projectIds: z
    .string()
    .optional()
    .describe(
      'Optional comma-separated list of project LUIDs to scope the cleanup to. ' +
        'If omitted, falls back to the server-configured INCLUDE_PROJECT_IDS bound (if any).',
    ),
  itemTypes: z
    .string()
    .optional()
    .describe(
      'Optional comma-separated subset of content types to clean up. Supported: ' +
        `${ALL_CONTENT_TYPES.join(', ')}. Defaults to all supported types.`,
    ),
  tag: z
    .string()
    .max(200)
    .optional()
    .describe(
      'Pending-deletion label applied during the tag/preview phase (reversible, visible in the ' +
        `Tableau UI). Defaults to '${DEFAULT_PENDING_DELETION_TAG}'.`,
    ),
  dryRun: z
    .enum(['true', 'false'])
    .optional()
    .describe(
      'When true (default), stop after the tag + notify report and never perform a confirmed delete ' +
        '— a safe rehearsal. Set to false to allow the confirmed-delete phase after human approval.',
    ),
} as const;

export const getStaleContentCleanupApplyPrompt: WebPromptFactory = () => ({
  name: 'stale-content-cleanup-apply',
  title: 'Stale content cleanup — tag, notify, and delete',
  description:
    'Tableau Cloud admin workflow (destructive Apply phase): find stale workbooks and published ' +
    'datasources via the deterministic `get-stale-content-report` tool, tag them pending-deletion ' +
    '(reversible), report owners to notify, then — only after a required human-in-the-loop ' +
    'approval — delete approved items to the recycle bin. Admin-only.',
  argsSchema,
  disabled: (config) => !config.adminToolsEnabled,
  callback: (args) => {
    const minAgeDays = args.minAgeDays
      ? parseInt(args.minAgeDays, 10)
      : STALE_CONTENT_MIN_AGE_DAYS_DEFAULT;
    const projectIds = args.projectIds
      ? args.projectIds
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];
    const requestedTypes = args.itemTypes
      ? args.itemTypes
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
          .filter(isContentType)
      : [];
    const itemTypes: ContentType[] = requestedTypes.length > 0 ? requestedTypes : ALL_CONTENT_TYPES;
    const tag = args.tag?.trim() ? args.tag.trim() : DEFAULT_PENDING_DELETION_TAG;
    const dryRun = args.dryRun !== 'false';

    const reportArgs: Record<string, unknown> = { minAgeDays, itemTypes };
    if (projectIds.length > 0) {
      reportArgs.projectIds = projectIds;
    }

    // Per-type routing table the model uses to map each stale row to the right list/delete tool.
    const routing = itemTypes.map((type) => ({ itemType: type, ...CONTENT_TYPE_REGISTRY[type] }));

    const hitlGate = renderHitlGate({
      action: 'delete',
      itemNoun: 'stale item',
      presentColumns: ['Item Type', 'Item Name', 'Project', 'Owner Email', 'Days Stale', 'Size'],
    });
    // One confirm-instruction block per delete tool in scope, so the wording is exact per tool name.
    const confirmInstructions = routing
      .map(({ deleteTool }) =>
        renderConfirmInstructions({ toolName: deleteTool, itemNoun: 'stale item' }),
      )
      .join('\n');

    const text = [
      'You are running the Tableau MCP **stale-content-cleanup-apply** workflow against the connected Tableau Cloud site.',
      'This is a DESTRUCTIVE admin workflow. Follow every step in order and never skip the human-confirmation break.',
      '',
      '**Content-type routing** — map each stale item to its tools by `Item Type`:',
      '',
      '```json',
      JSON.stringify(routing, null, 2),
      '```',
      '',
      '**Step 1 — Report (read-only).** Call `get-stale-content-report` exactly once with the arguments below. ' +
        'Use the rows it returns verbatim — do **not** add or remove rows and do **not** recompute `daysSinceLastUse`.',
      '',
      '```json',
      JSON.stringify({ toolArgs: reportArgs }, null, 2),
      '```',
      '',
      'If `rows` is empty, state "No stale items found above the threshold." and stop.',
      '',
      '**Step 2 — Resolve LUIDs.** The report emits a numeric `itemId`, NOT the LUID the delete tools require. ' +
        "For each row, look up its LUID using the routing table's `listTool` with a filter matching the item by name and project, e.g. " +
        '`filter: "name:eq:<itemName>,projectName:eq:<project>"`, and read the `id` (LUID) from the match. ' +
        'If a lookup returns zero or more than one match (ambiguous name), DO NOT guess — record it as "unresolved (skipped)" and exclude it from all later steps.',
      '',
      '**Step 3 — Tag (reversible preview).** For each resolved item, call its `deleteTool` with `confirm` omitted ' +
        `and \`tag: "${tag}"\` (and the resolved \`idArg\` value). This tags the item '${tag}' (reversible, visible in the Tableau UI) ` +
        "and returns a per-item `confirmationToken`. Nothing is deleted in this step. Keep each item's `confirmationToken`.",
      '',
      '**Step 4 — Notify report (report-only).** Build a notification table of the affected items grouped by owner. ' +
        'Use the `ownerEmail` from the report; for any item missing an owner email, collect its owner LUID (e.g. the ' +
        '`owner.id` from the list-* lookup in Step 2) and call `list-users` once with ' +
        '`filter: "id:in:<luidA>|<luidB>|..."` to resolve those LUIDs to emails. NO email is sent — this is report-only.',
      '',
      '**Step 5 — ' + (dryRun ? 'STOP (dry run).' : 'Human confirmation break.') + '**',
      hitlGate,
      '',
      ...(dryRun
        ? [
            'DRY RUN is active (dryRun defaults to true): present the tagged items and the notify table, then STOP. ' +
              'Do NOT call any delete tool with confirm: true. Tell the user to re-run with dryRun: false to perform deletions after review.',
          ]
        : [
            '**Step 6 — Grace check.** Before deleting, confirm with the user that the grace/notification window has elapsed ' +
              'and re-verify the items are still the intended, still-stale targets.',
            '',
            '**Step 7 — Delete (confirmed).**',
            confirmInstructions,
            '',
            'Deleted workbooks and data sources are moved to the Tableau recycle bin and can be restored for a limited time ' +
              'before permanent removal.',
          ]),
      '',
      '**Fixed notes**',
      '- This workflow only deletes items the user explicitly approved; tagged-but-unapproved items remain tagged and undeleted.',
      "- Deletion uses Tableau's recycle bin (soft delete) — recoverable for a limited time.",
      '- Notification is report-only; no emails are sent by this workflow.',
      '- Admin-only, Tableau Cloud. Items skipped as unresolved/ambiguous are never deleted.',
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
