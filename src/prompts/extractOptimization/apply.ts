import { z } from 'zod';

import { renderConfirmInstructions, renderHitlGate } from '../_lib/confirm.js';
import { EXTRACT_REFRESH_JOB_TYPES, JOB_PERFORMANCE_FIELDS } from '../_lib/jobPerformance.js';
import { WebPromptFactory } from '../registry.js';

const INVENTORY_TOOL = 'list-extract-refresh-tasks';
const PERFORMANCE_TOOL = 'query-admin-insights';
const UPDATE_TOOL = 'update-cloud-extract-refresh-task';
const DELETE_TOOL = 'delete-content';

const argsSchema = {
  lookbackDays: z
    .string()
    .regex(/^[1-9]\d*$/, 'lookbackDays must be a positive integer')
    .optional()
    .describe(
      'Window on Started At for the job performance read, in days. ' +
        'Tableau Cloud caps lookback at 90 (365 with Advanced Management).',
    ),
  taskIds: z
    .string()
    // Constrain to a safe character class. `taskIds` is interpolated into the workflow prompt
    // text (each id wrapped in backticks), so restricting it to alphanumerics/comma/space/dash
    // closes a prompt-injection vector (e.g. a value with quotes/backticks trying to coerce the
    // model into auto-confirming). Mirrors the `tag` defense in stale-content-cleanup-apply.
    .regex(
      /^[A-Za-z0-9, -]+$/,
      'taskIds must contain only letters, numbers, commas, spaces, and dashes',
    )
    .optional()
    .describe(
      'Optional comma-separated list of extract refresh task IDs (UUIDs) to scope the run to. ' +
        'When omitted, the workflow analyzes every task returned by ' +
        `\`${INVENTORY_TOOL}\`.`,
    ),
  // MCP prompt arguments are string-only over the wire (the GetPrompt request carries
  // `arguments: { [key]: string }`), so this is a string enum rather than z.boolean(). Parsed to a
  // boolean below via `args.dryRun !== 'false'`.
  dryRun: z
    .enum(['true', 'false'])
    .optional()
    .describe(
      'When "true" (default), produce only the recommendation report — do not call ' +
        `\`${UPDATE_TOOL}\` or \`${DELETE_TOOL}\`. Set to "false" to allow the apply step ` +
        'after the human-in-the-loop confirmation.',
    ),
} as const;

/**
 * Builds the VDS query the model sends to `query-admin-insights-job-performance`. The job-type
 * filter is always present (locks the read to the four extract-refresh variants); the `Started At`
 * filter is added only when the caller supplied `lookbackDays`, so the prompt body still produces
 * a deterministic JSON blob for the no-arg default.
 */
const buildPerformanceToolArgs = (lookbackDays?: number): Record<string, unknown> => {
  const filters: Array<Record<string, unknown>> = [
    {
      field: { fieldCaption: 'Job Type' },
      filterType: 'SET',
      values: EXTRACT_REFRESH_JOB_TYPES,
      exclude: false,
    },
  ];
  if (lookbackDays !== undefined) {
    filters.push({
      field: { fieldCaption: 'Started At' },
      filterType: 'DATE',
      periodType: 'DAYS',
      dateRangeType: 'LASTN',
      rangeN: lookbackDays,
    });
  }
  return {
    kind: 'job-performance',
    query: {
      fields: JOB_PERFORMANCE_FIELDS.map((fieldCaption) => ({ fieldCaption })),
      filters,
    },
  };
};

export const getExtractOptimizationApplyPrompt: WebPromptFactory = () => ({
  name: 'extract-optimization-apply',
  title: 'Extract refresh optimization — apply changes',
  description:
    'Tableau Cloud admin workflow (destructive Apply phase): take the recommendations from the ' +
    'inform step and apply schedule changes or deletions to extract refresh tasks. Orchestrates ' +
    `\`${INVENTORY_TOOL}\`, \`${PERFORMANCE_TOOL}\`, \`${UPDATE_TOOL}\`, and \`${DELETE_TOOL}\`. ` +
    'Defaults to a dry run; requires explicit human confirmation before any PUT or DELETE.',
  argsSchema,
  disabled: (config) => !config.adminToolsEnabled,
  callback: (args) => {
    const dryRun = args.dryRun !== 'false';
    const lookbackDays = args.lookbackDays ? parseInt(args.lookbackDays, 10) : undefined;
    const taskIds: string[] = args.taskIds
      ? Array.from(
          new Set<string>(
            args.taskIds
              .split(',')
              .map((value: string) => value.trim())
              .filter(Boolean),
          ),
        )
      : [];

    const performanceToolArgs = buildPerformanceToolArgs(lookbackDays);
    const taskIdScope =
      taskIds.length > 0
        ? `the following task IDs only: ${taskIds.map((id: string) => `\`${id}\``).join(', ')}`
        : 'every task returned by the inventory step';

    const hitlGate = renderHitlGate({
      actionVerb: 'update or delete',
      actionGerund: 'update or deletion',
      itemNounSingular: 'extract refresh task',
      itemNounPlural: 'extract refresh tasks',
      presentColumns: ['Task ID', 'Item', 'Current Frequency', 'Recommendation', 'New Schedule'],
    });
    // Single confirm-instruction block that covers both apply tools — the recommendation table
    // already routes each row to `update-cloud-extract-refresh-task` or `delete-content`
    // via its `Recommendation` column, so one block points back at that routing rather than
    // duplicating per tool.
    // Extract refresh tasks have no Tableau-tag affordance in the REST API, so we use the
    // friction-token contract instead of the server-authoritative pending-deletion tag gate
    // (see _lib/confirm.ts).
    const confirmInstructions = renderConfirmInstructions({
      toolRef:
        `the appropriate tool — \`${UPDATE_TOOL}\` for \`downgrade\` rows, ` +
        `\`${DELETE_TOOL}\` for \`delete\` rows`,
      itemNoun: 'extract refresh task',
      gateKind: 'token',
    });

    const modeLine = dryRun
      ? '`dryRun = true` — report only. Do **not** call `' +
        UPDATE_TOOL +
        '` or `' +
        DELETE_TOOL +
        '` under any circumstance.'
      : '`dryRun = false` — apply step is permitted **only after** the human confirms in Step 4.';

    const text = [
      'You are running the Tableau MCP **extract-optimization-apply** workflow against the connected Tableau Cloud site.',
      'This is a DESTRUCTIVE admin workflow. Follow every step in order and never skip the human-confirmation break.',
      'CRITICAL: Steps 1-3 are READ-ONLY. Make NO update or deletion call until the user has ' +
        'explicitly approved a specific set of tasks at the Step 4 human-confirmation break.',
      '',
      `**Mode:** ${modeLine}`,
      `**Scope:** ${taskIdScope}.`,
      '',
      `**Step 1 — Inventory (read-only).** Call \`${INVENTORY_TOOL}\` exactly once with no filter to retrieve every extract refresh task on the site.`,
      ...(taskIds.length > 0
        ? [
            'After the call returns, narrow the working set client-side to the task IDs listed in **Scope** above. If any requested ID is missing from the inventory, list it under "Missing tasks" in the final report and skip it for the remainder of the workflow.',
          ]
        : []),
      '',
      `**Step 2 — Performance signals (read-only).** Call \`${PERFORMANCE_TOOL}\` with \`kind: "job-performance"\` and the arguments below. The tool returns the already-filtered rows for extract refresh job types. Do **not** add or remove rows. Do **not** recompute durations.`,
      '',
      '```json',
      JSON.stringify(performanceToolArgs, null, 2),
      '```',
      '',
      '**Step 3 — Recommend (read-only).** Join the inventory (Step 1) and the performance rows (Step 2) on the underlying datasource or workbook. For each task in scope, produce one row in a Markdown table with these columns:',
      '',
      '`Task ID | Item | Current Frequency | Next Run | Recent Job Result | Avg Duration | Failure Count | Recommendation | New Schedule`',
      '',
      'Recommendation must be one of:',
      '- `keep` — no change.',
      '- `downgrade` — reduce frequency or shift window. Populate `New Schedule` with the proposed `frequency` + `frequencyDetails.start` (and `end` for `Hourly`), respecting the 5-minute boundary rule and the Hourly minute-match rule.',
      '- `delete` — remove the task. Use this only when the underlying item has had zero successful runs in the lookback window AND the failure count is non-zero, OR the item is otherwise demonstrably abandoned. Mark `New Schedule` as `—` for delete rows.',
      '',
      'Sort the table: `delete` rows first, then `downgrade`, then `keep`. Group by recommendation.',
      '',
      '**Step 4 — Human confirmation break.**',
      hitlGate,
      '',
      'Present the table from Step 3 and ask the user, in plain language: "Apply the recommended `delete` and `downgrade` changes to these N extract refresh tasks? Reply `yes` to proceed, `no` to abort, or list specific Task IDs to apply selectively."',
      '',
      'Do **not** call `' +
        UPDATE_TOOL +
        '` or `' +
        DELETE_TOOL +
        '` without the user\'s explicit approval in this turn. A previous approval does NOT carry forward. If the user replies with anything other than `yes` or a non-empty list of Task IDs, stop and report "Aborted by user".',
      '',
      ...(dryRun
        ? [
            "**Because `dryRun = true`, stop here regardless of the user's reply.** Print the table from Step 3 plus a one-line note: `Dry run — no changes applied. Re-run with dryRun = false to apply.`",
          ]
        : [
            '**Step 5 — Preview (per approved task, read-only).** ONLY for the tasks the user explicitly approved above, in order:',
            `- For \`downgrade\` rows: call \`${UPDATE_TOOL}\` with \`{ taskId, schedule: <proposed schedule> }\` and \`confirm\` omitted. The schedule must satisfy the constraints documented on the tool (5-minute boundary; Hourly minute match and end > start; Daily/Weekly/Monthly omit \`end\`; Hourly/Daily require ≥1 \`weekDay\` interval; Weekly requires ≥1 \`weekDay\`; Monthly requires ≥1 \`monthDay\`). The tool validates the schedule and returns a per-task \`confirmationToken\` without calling the Tableau update endpoint. Keep each task's \`confirmationToken\`.`,
            `- For \`delete\` rows: call \`${DELETE_TOOL}\` with \`{ resourceType: "extract-refresh-task", resourceId: <taskId> }\` and \`confirm\` omitted. The tool returns a per-task \`confirmationToken\` without deleting. Keep each task's \`confirmationToken\`.`,
            '- Do **not** parallelize. Wait for each preview to complete before the next. Nothing is updated or deleted in this step.',
            '',
            '**Step 6 — Apply (confirmed).**',
            confirmInstructions,
            '',
            `- For \`downgrade\` rows: call \`${UPDATE_TOOL}\` again with \`{ taskId, schedule, confirm: true, confirmationToken: <the token Step 5 returned for this task> }\`.`,
            `- For \`delete\` rows: call \`${DELETE_TOOL}\` again with \`{ resourceType: "extract-refresh-task", resourceId: <taskId>, confirm: true, confirmationToken: <the token Step 5 returned for this task> }\`. **This is irreversible.**`,
            '- Do **not** parallelize. Wait for each call to complete before the next.',
            '- If a single call returns an error, stop immediately, record the failure, and report the partial state in the final report — do **not** continue with the remaining changes.',
          ]),
      '',
      `**Step ${dryRun ? 5 : 7} — Final report.** Print:`,
      '- A "Changes applied" section with one bullet per task touched: `Task ID — <delete | downgrade to <new schedule>> — <success | error: <code/message>>`.',
      '- A "Skipped" section listing any `keep` rows or rows the user excluded.',
      ...(taskIds.length > 0
        ? [
            '- A "Missing tasks" section listing any requested Task IDs that were not found in the inventory.',
          ]
        : []),
      '- A trailing note: `Tableau Cloud job lookback caps at 90 days (365 days with Advanced Management).`',
      '',
      '**Fixed notes**',
      '- No task is updated or deleted until the user approves a specific task set at the Step 4 break.',
      '- This workflow only acts on tasks the user explicitly approved; tasks the user did not approve are never touched.',
      `- \`${DELETE_TOOL}\` is irreversible; \`${UPDATE_TOOL}\` is reversible by re-applying the prior schedule.`,
      '- Admin-only, Tableau Cloud. Tasks the user excluded or that are missing from the inventory are never touched.',
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
