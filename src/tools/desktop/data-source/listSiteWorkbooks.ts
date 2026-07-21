import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { endpointNotInThisBuild, isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { SiteWorkbookItem } from '../../../desktop/externalApi/types.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError, McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};

class ExternalApiRequiredError extends McpToolError {
  constructor(toolName: string) {
    super({
      type: 'external-api-required',
      message: `${toolName} requires the Tableau Desktop External Client API transport.`,
      statusCode: 400,
    });
  }
}

const title = 'List Site Workbooks';
export const getListSiteWorkbooksTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listSiteWorkbooks = new DesktopTool({
    server,
    name: 'list-site-workbooks',
    title,
    description: 'List workbooks published to the connected site.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await listSiteWorkbooks.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(listSiteWorkbooks.name).toErr();
          }

          const result = await executor.listSiteWorkbooks(extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('site workbooks').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            workbooks: (result.value.workbooks ?? []).map(projectWorkbook),
          });
        },
      });
    },
  });

  return listSiteWorkbooks;
};

function projectWorkbook(workbook: SiteWorkbookItem): {
  id?: string;
  luid?: string;
  name?: string;
  project?: string;
} {
  return {
    ...(workbook.id !== undefined ? { id: workbook.id } : {}),
    ...(workbook.luid !== undefined ? { luid: workbook.luid } : {}),
    ...(workbook.name !== undefined ? { name: workbook.name } : {}),
    ...(workbook.project !== undefined ? { project: workbook.project } : {}),
  };
}
