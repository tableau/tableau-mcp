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

const title = 'Get App Info';
export const getAppInfoTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getAppInfo = new DesktopTool({
    server,
    name: 'get-app-info',
    title,
    description: 'Identify the Desktop build when an endpoint 404s as too-new.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (_args, extra): Promise<CallToolResult> => {
      return await getAppInfo.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          const sessionResult = resolveSession(undefined);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(getAppInfo.name).toErr();
          }

          const result = await executor.getApp(extra.signal);
          if (result.isErr()) {
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            ...(result.value.applicationVersion !== undefined
              ? { applicationVersion: result.value.applicationVersion }
              : {}),
            ...(result.value.build !== undefined ? { build: result.value.build } : {}),
            ...(result.value.edition !== undefined ? { edition: result.value.edition } : {}),
            ...(result.value.os !== undefined ? { os: result.value.os } : {}),
          });
        },
      });
    },
  });

  return getAppInfo;
};
