import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
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

const title = 'Get Workbook Inventory';
export const getWorkbookInventoryTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getWorkbookInventory = new DesktopTool({
    server,
    name: 'get-workbook-inventory',
    title,
    description:
      'One orienting read: title, unsaved changes, and worksheet/dashboard/storyboard inventory in a single call. Use first to understand the open workbook before authoring.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (_args, extra): Promise<CallToolResult> => {
      return await getWorkbookInventory.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          const sessionResult = resolveSession(undefined);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(getWorkbookInventory.name).toErr();
          }

          const result = await executor.getWorkbook(extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return new McpToolError({
                type: 'endpoint-not-in-this-build',
                message:
                  'This Tableau Desktop build does not serve the workbook inventory endpoint yet. ' +
                  'Use get-app-info to identify the build; this read lights up on a newer Desktop update. Do not retry.',
                statusCode: 404,
              }).toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            title: result.value.title,
            ...(result.value.location !== undefined ? { location: result.value.location } : {}),
            unsavedChanges: result.value.unsavedChanges,
            worksheets: result.value.worksheets ?? [],
            dashboards: result.value.dashboards ?? [],
            storyboards: result.value.storyboards ?? [],
          });
        },
      });
    },
  });

  return getWorkbookInventory;
};

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
