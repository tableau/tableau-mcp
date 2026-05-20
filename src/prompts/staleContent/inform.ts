import { z } from 'zod';

import { STALE_CONTENT_MIN_AGE_DAYS_DEFAULT } from '../../overridableConfig.js';
import { WebPromptFactory } from '../registry.js';

const argsSchema = {
  minAgeDays: z
    .string()
    .regex(/^\d+$/, 'minAgeDays must be a positive integer')
    .optional()
    .describe(
      `Minimum days since last access for content to be considered stale. Defaults to the server-configured threshold (default ${STALE_CONTENT_MIN_AGE_DAYS_DEFAULT}). ` +
        'Bounded by Admin Insights TS Events 90-day lookback window unless Advanced Management is enabled.',
    ),
  projectIds: z
    .string()
    .optional()
    .describe(
      'Optional comma-separated list of project LUIDs to scope the report to. ' +
        'If omitted, falls back to the server-configured INCLUDE_PROJECT_IDS bound (if any).',
    ),
} as const;

export const getStaleContentCleanupInformPrompt: WebPromptFactory = () => ({
  name: 'stale-content-cleanup-inform',
  title: 'Stale content cleanup — generate inform report',
  description:
    'Tableau Cloud admin workflow: identify stale workbooks and published datasources by ' +
    'invoking the deterministic `get-stale-content-report` tool, which performs the ' +
    'TS Events / Site Content anti-join and threshold filter server-side. Read-only.',
  argsSchema,
  enabled: (config) => config.adminToolsEnabled,
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

    const toolArgs: Record<string, unknown> = { minAgeDays };
    if (projectIds.length > 0) {
      toolArgs.projectIds = projectIds;
    }

    const text = [
      'You are running the Tableau MCP **stale-content-cleanup-inform** workflow against the connected Tableau Cloud site.',
      '',
      'Call the `get-stale-content-report` tool exactly once with the arguments below. The tool runs the TS Events / Site Content anti-join, applies the staleness threshold, and returns the already-filtered rows. Do **not** add or remove rows. Do **not** recompute `daysSinceLastUse`. Render the response as documented.',
      '',
      '**Tool arguments**',
      '',
      '```json',
      JSON.stringify(toolArgs, null, 2),
      '```',
      '',
      '**Render the response as follows**',
      '',
      '1. Print a header line: `Stale content report (threshold = <thresholdDays> days, total = <totalStaleItems> items, total size = <totalStaleSizeBytes> bytes)`.',
      '2. Render `rows` as a Markdown table with columns: `Project | Item Type | Item Name | Owner Email | Last Used | Days Stale | Size (bytes) | Never Accessed`. Preserve the order returned by the tool — the server already sorted descending by `daysSinceLastUse`, then by `size`.',
      '3. If `rows` is empty, state explicitly: "No stale items found above the threshold." and stop.',
      '4. Below the table, append the following fixed notes:',
      '   - Note: TS Events caps at 90 days lookback on Tableau Cloud (365 days with Advanced Management). Items with `Days Stale` ≥ 90 may have been accessed earlier than the lookback window might suggest.',
      '   - Note: Only `Access` events count as "use". Refresh-only datasources may appear stale even if refreshed nightly.',
      '   - Note: This report is read-only. No tagging, notification, or deletion actions are performed.',
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
