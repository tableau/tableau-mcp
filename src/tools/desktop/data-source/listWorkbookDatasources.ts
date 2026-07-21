import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { endpointNotInThisBuild, isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { DatasourceItem } from '../../../desktop/externalApi/types.js';
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

const title = 'List Workbook Datasources';
export const getListWorkbookDatasourcesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listWorkbookDatasources = new DesktopTool({
    server,
    name: 'list-workbook-datasources',
    title,
    description:
      "List the workbook's OWN connected datasources (id/name/caption); pair with list-site-datasources for published LUIDs.",
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await listWorkbookDatasources.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(listWorkbookDatasources.name).toErr();
          }

          const result = await executor.listWorkbookDatasources(extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('workbook datasources').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            datasources: (result.value.datasources ?? []).map(projectDatasource),
          });
        },
      });
    },
  });

  return listWorkbookDatasources;
};

function projectDatasource(datasource: DatasourceItem): {
  id?: string;
  name?: string;
  caption?: string;
} {
  return {
    ...(datasource.id !== undefined ? { id: datasource.id } : {}),
    ...(datasource.name !== undefined ? { name: datasource.name } : {}),
    ...(datasource.caption !== undefined ? { caption: datasource.caption } : {}),
  };
}
