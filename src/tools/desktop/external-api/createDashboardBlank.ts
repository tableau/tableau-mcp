import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveSession } from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError, UnknownError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { endpointNotInThisBuild, isRouteMissing } from './externalApiToolUtils.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      '0-based tab position to insert the new dashboard before, shifting the tab at that ' +
        'position (and beyond) right. Omit or pass a value >= the current tab count to append ' +
        'at the end.',
    ),
};
const title = 'Create Blank Dashboard';

export const getCreateDashboardBlankTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const createDashboardBlankTool = new DesktopTool({
    server,
    name: 'create-dashboard-blank',
    title,
    description:
      'Create a new empty dashboard in the open workbook, with a Tableau-generated name. ' +
      'To build a populated dashboard instead, use build-and-apply-dashboard.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, index }, extra): Promise<CallToolResult> => {
      return await createDashboardBlankTool.logAndExecute({
        extra,
        args: { session, index },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }
          const executor = await extra.getExecutor(sessionResult.value);

          const result = await executor.createBlankDashboard(index, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('create-dashboard-blank').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          const createdSheet = result.value.createdSheets[0];
          if (!createdSheet) {
            return new UnknownError('Create blank dashboard returned no created sheet.').toErr();
          }

          return new Ok({
            message: `Created blank dashboard "${createdSheet.name}".`,
            createdSheet,
          });
        },
      });
    },
  });

  return createDashboardBlankTool;
};
