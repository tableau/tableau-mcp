import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveSession } from '../../../../desktop/session/sessionResolution.js';
import { DesktopMcpServer } from '../../../../server.desktop.js';
import { sessionParam } from '../../params.js';
import { jsonToolResult, type StructuredResult } from '../../structuredContent.js';
import { DesktopTool } from '../../tool.js';
import { composeDashboardCore, validateComposeDashboardInput } from './composeDashboardCore.js';

const layoutSchema = z.object({
  layoutType: z.enum(['auto-grid', 'rows', 'columns']).optional().default('auto-grid'),
  gridColumns: z.number().int().min(1).max(6).optional(),
});

const paramsSchema = {
  session: sessionParam(),
  dashboardName: z.string().trim().min(1).max(255).describe('Dashboard name.'),
  worksheetNames: z
    .array(z.string().trim().min(1).max(255))
    .min(1)
    .max(6)
    .describe('Rendered worksheet names (1-6).'),
  title: z.string().trim().min(1).max(255).optional().describe('Optional title.'),
  layout: layoutSchema.optional().describe('Layout.'),
};

type ComposeDashboardSuccess = {
  applied: true;
  retrySafe: false;
  dashboard: string;
  worksheets: string[];
  replaced: boolean;
  verification: { status: 'passed'; issues: [] };
};

type ComposeDashboardResult = StructuredResult<ComposeDashboardSuccess>;

const title = 'Compose dashboard';

export const getComposeDashboardTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'compose-dashboard',
    title,
    description: 'Build dashboard from live worksheets.',
    paramsSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    callback: async (
      { session, dashboardName, worksheetNames, title: titleText, layout },
      extra,
    ): Promise<CallToolResult> => {
      return await tool.logAndExecute<ComposeDashboardResult>({
        extra,
        args: { session, dashboardName, worksheetNames, title: titleText, layout },
        callback: async () => {
          const inputError = validateComposeDashboardInput(worksheetNames);
          if (inputError) return inputError.toErr();
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) return sessionResult.error.toErr();
          const executor = await extra.getExecutor(sessionResult.value);
          const outcome = await composeDashboardCore({
            dashboardName,
            worksheetNames,
            title: titleText,
            layout,
            executor,
            signal: extra.signal,
          });
          if (outcome.state !== 'applied') return outcome.error.toErr();
          return Ok({
            applied: true,
            retrySafe: false,
            ...outcome.receipt,
          });
        },
        getSuccessResult: (result) => jsonToolResult(result, { isError: false }),
      });
    },
  });

  return tool;
};
