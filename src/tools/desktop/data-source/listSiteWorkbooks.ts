import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { SiteWorkbookItem } from '../../../desktop/externalApi/types.js';
import { resolveSession } from '../../../desktop/sessionResolution.js';
import { DesktopCommandExecutionError, McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {};

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
    callback: async (_args, extra): Promise<CallToolResult> => {
      return await listSiteWorkbooks.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          const sessionResult = resolveSession(undefined);
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
              return new McpToolError({
                type: 'endpoint-not-in-this-build',
                message:
                  'This Tableau Desktop build does not serve the site workbooks endpoint yet. ' +
                  'Use get-app-info to identify the build; this read lights up on a newer Desktop update. Do not retry.',
                statusCode: 404,
              }).toErr();
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

function isRouteMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const e = error as { type?: string; error?: { code?: string; message?: string } };
  return (
    e.type === 'command-failed' &&
    e.error?.code === 'not-found' &&
    typeof e.error?.message === 'string' &&
    e.error.message.includes('No route matches')
  );
}
