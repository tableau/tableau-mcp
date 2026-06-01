import { z } from 'zod';

import { WebPromptFactory } from '../registry.js';

const argsSchema = {
  projectIds: z
    .string()
    .optional()
    .describe(
      'Optional comma-separated list of project LUIDs to scope the analysis to. ' +
        'If omitted, all extract refresh tasks visible to the caller are analyzed.',
    ),
} as const;

export const getExtractOptimizationInformPrompt: WebPromptFactory = () => ({
  name: 'extract-optimization-inform',
  title: 'Extract refresh schedule optimization — generate inform report',
  description:
    'Tableau Cloud admin workflow: analyze extract refresh tasks to recommend schedule ' +
    'changes (downgrade frequency, disable, or move time window) based on schedule metadata, ' +
    'consecutive failure counts, and task priority. Read-only.',
  argsSchema,
  disabled: (config) => !config.adminToolsEnabled,
  callback: (args) => {
    const projectIds = args.projectIds
      ? args.projectIds
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];

    const toolArgs: Record<string, unknown> = {};
    if (projectIds.length > 0) {
      toolArgs.filter = `datasource.id:in:${projectIds.join('|')}`;
    }

    const text = [
      'You are running the Tableau MCP **extract-optimization-inform** workflow against the connected Tableau Cloud site.',
      '',
      '## Step 1 — Retrieve extract refresh tasks',
      '',
      'Call the `list-extract-refresh-tasks` tool exactly once with the arguments below.',
      '',
      '**Tool arguments**',
      '',
      '```json',
      JSON.stringify(Object.keys(toolArgs).length > 0 ? toolArgs : {}, null, 2),
      '```',
      '',
      '## Step 2 — Analyze and recommend',
      '',
      'Using the returned tasks, produce optimization recommendations. For each task, evaluate:',
      '',
      '1. **Frequency vs. priority**: Tasks with high frequency (Hourly) but low priority (< 50) are candidates for downgrade to Daily or Weekly.',
      '2. **Consecutive failures**: Tasks with `consecutiveFailedCount > 0` indicate reliability issues — recommend investigation or disabling until the underlying issue is resolved.',
      '3. **Schedule clustering**: Multiple tasks scheduled at the same `nextRunAt` time suggest load concentration — recommend spreading across time windows.',
      '',
      '## Step 3 — Render the report',
      '',
      'Present results as follows:',
      '',
      '1. Print a header line: `Extract optimization report (total tasks = <count>)`.',
      '2. Print a summary: number of tasks analyzed, number with recommendations, number with consecutive failures.',
      '3. Render recommendations as a Markdown table with columns: `Task ID | Target (Datasource/Workbook) | Current Frequency | Next Run | Consecutive Failures | Priority | Recommendation`.',
      '   - Recommendation values: `Downgrade to Daily`, `Downgrade to Weekly`, `Disable (failing)`, `Move time window`, or `No change`.',
      '4. If no tasks are returned, state: "No extract refresh tasks found on this site." and stop.',
      '5. If no tasks warrant a recommendation, state: "All extract refresh schedules appear appropriately configured." and stop.',
      '6. Below the table, append the following fixed notes:',
      '   - Note: Recommendations are heuristic-based on schedule metadata only. For usage-based optimization, pair with Admin Insights Job Performance data.',
      '   - Note: This report is read-only. No schedule changes are applied.',
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
