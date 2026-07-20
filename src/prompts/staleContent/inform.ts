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
    'invoking the deterministic `query-admin-insights` tool (kind: "stale-content"), which performs the ' +
    'TS Events / Site Content anti-join and threshold filter server-side. Read-only.',
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

    const toolArgs: Record<string, unknown> = { kind: 'stale-content', minAgeDays };
    if (projectIds.length > 0) {
      toolArgs.projectIds = projectIds;
    }

    const text = [
      'You are running the Tableau MCP **stale-content-cleanup-inform** workflow against the connected Tableau Cloud site.',
      '',
      'Call `query-admin-insights` with `kind: "stale-content"` exactly once, passing the arguments below. The tool runs the TS Events / Site Content anti-join, applies the staleness threshold, and returns the already-filtered rows. Do **not** add or remove rows. Do **not** recompute `daysSinceLastUse`. Render the response as documented.',
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
      '2. If `mcp.warnings` contains an entry with `type: "ROW_CAP_EXCEEDED"`, the server withheld the row payload (`rows` is empty) because `totalStaleItems` exceeds the safety cap (`maxRows`). Do **not** render the table and do **not** say "No stale items found" — that would be false. Instead state that the site has `<totalStaleItems>` stale items totaling `<totalStaleSizeBytes>` bytes, that the detailed rows were withheld for safety because this exceeds the `<maxRows>`-row cap, and that the user should narrow scope (e.g. a specific `projectIds` subset or a higher `minAgeDays`) and re-run. Then skip to the fixed notes.',
      '3. Otherwise, render `rows` as a Markdown table with columns: `Project | Item Type | Item Name | Owner Email | Last Used | Days Stale | Size (bytes) | Never Accessed`. Preserve the order returned by the tool — the server already sorted descending by `daysSinceLastUse`, then by `size`.',
      '4. If `rows` is empty (and no ROW_CAP_EXCEEDED warning is present), state explicitly: "No stale items found above the threshold." and stop.',
      '5. Below the table, append the following fixed notes:',
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
