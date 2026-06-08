import { z } from 'zod';

import { WebPromptFactory } from '../registry.js';
import { renderNotesFor } from './renderNotes.js';

const TOOL_NAME = 'query-admin-insights-job-performance';

// Raw `Job Type` values as stored in the datasource (no spaces). Extract refresh
// spans direct and Bridge variants, so the default scope is all four.
const DEFAULT_JOB_TYPES = [
  'RefreshExtracts',
  'IncrementExtracts',
  'RefreshExtractsViaBridge',
  'IncrementExtractsViaBridge',
];

// Placeholder the model substitutes per discovered job type in discovery mode.
const JOB_TYPE_PLACEHOLDER = '__JOB_TYPE__';

// Fields requested for the optimization read. Kept here rather than in the
// description to keep the prompt listing small.
const FIELDS = [
  'Item Name',
  'Job Type',
  'Job Result',
  'Started At',
  'Job Duration',
  'Job Execution Duration',
  'Schedule Name',
  'Was Manual Run',
  'Error Message',
];

const argsSchema = {
  jobType: z
    .string()
    .optional()
    .describe(
      'Comma-separated raw Job Type values to analyze (e.g. "RefreshExtracts,RunFlow"). ' +
        'Defaults to the extract refresh types. Ignored when discover is true.',
    ),
  lookbackDays: z
    .string()
    .regex(/^\d+$/, 'lookbackDays must be a positive integer')
    .optional()
    .describe(
      'Window on Started At, in days. Tableau Cloud caps lookback at 90 (365 with Advanced Management).',
    ),
  limit: z
    .string()
    .regex(/^\d+$/, 'limit must be a positive integer')
    .optional()
    .describe('Maximum rows to return per job-type query.'),
  discover: z
    .enum(['true', 'false'])
    .optional()
    .describe('When true, first discover the Job Type values on the site, then analyze each.'),
} as const;

// Builds the VDS query the model sends to the job-performance tool. jobTypeValues
// holds one or more literal values, or the single placeholder in discovery mode.
const buildToolArgs = (
  jobTypeValues: ReadonlyArray<string>,
  lookbackDays?: number,
  limit?: number,
): Record<string, unknown> => {
  const filters: Array<Record<string, unknown>> = [
    {
      field: { fieldCaption: 'Job Type' },
      filterType: 'SET',
      values: jobTypeValues,
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

  const toolArgs: Record<string, unknown> = {
    query: { fields: FIELDS.map((fieldCaption) => ({ fieldCaption })), filters },
  };
  if (limit !== undefined) {
    toolArgs.limit = limit;
  }
  return toolArgs;
};

export const getJobOptimizationInformPrompt: WebPromptFactory = () => ({
  name: 'job-optimization-inform',
  title: 'Job optimization — generate inform report',
  description:
    'Tableau Cloud admin workflow: analyze Admin Insights job performance and surface optimization ' +
    `signals by invoking the \`${TOOL_NAME}\` tool. Defaults to extract refresh jobs; set discover ` +
    'to analyze every Job Type on the site. Read-only.',
  argsSchema,
  disabled: (config) => !config.adminToolsEnabled,
  callback: (args) => {
    const discover = args.discover === 'true';
    const requested = args.jobType
      ? args.jobType
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
      : [];
    const jobTypeValues = discover
      ? [JOB_TYPE_PLACEHOLDER]
      : requested.length > 0
        ? requested
        : DEFAULT_JOB_TYPES;

    const lookbackDays = args.lookbackDays ? parseInt(args.lookbackDays, 10) : undefined;
    const limit = args.limit ? parseInt(args.limit, 10) : undefined;

    const toolArgs = buildToolArgs(jobTypeValues, lookbackDays, limit);
    const notes = renderNotesFor(discover ? DEFAULT_JOB_TYPES : jobTypeValues);

    const lines: string[] = [
      `You are running the Tableau MCP **job-optimization-inform** workflow (read-only) using \`${TOOL_NAME}\`.`,
      '',
    ];

    if (discover) {
      lines.push(
        '**Step 1 — Discover job types.** Call the tool once requesting only the Job Type field:',
        '',
        '```json',
        JSON.stringify({ query: { fields: [{ fieldCaption: 'Job Type' }] } }, null, 2),
        '```',
        '',
        'Collect the distinct `Job Type` values returned — these are the job types on this site.',
        '',
        `**Step 2 — Analyze each job type.** For each discovered value, call \`${TOOL_NAME}\` exactly ` +
          `once, replacing \`"${JOB_TYPE_PLACEHOLDER}"\` with that value:`,
      );
    } else {
      lines.push(
        `Call \`${TOOL_NAME}\` exactly once with the arguments below. It returns the already-filtered ` +
          'rows for the selected job types.',
      );
    }

    lines.push(
      '',
      '```json',
      JSON.stringify(toolArgs, null, 2),
      '```',
      '',
      'Do **not** add or remove rows. Do **not** recompute durations. Use the rows the tool returns.',
      '',
      `**Render the response** ${discover ? 'per job type' : ''} as a Markdown table of the returned ` +
        'rows, followed by an "Optimization signals" section derived from those rows:',
      ...notes.map((n) => `- ${n}`),
      '',
      '- Note: Tableau Cloud job lookback caps at 90 days (365 days with Advanced Management).',
      '- Note: This report is read-only. No schedule, pause, or delete actions are performed.',
    );

    return {
      messages: [{ role: 'user', content: { type: 'text', text: lines.join('\n') } }],
    };
  },
});
