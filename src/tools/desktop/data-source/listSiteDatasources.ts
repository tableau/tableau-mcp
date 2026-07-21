import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { SiteDatasourceItem } from '../../../desktop/externalApi/types.js';
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

const title = 'List Site Datasources';
export const getListSiteDatasourcesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listSiteDatasources = new DesktopTool({
    server,
    name: 'list-site-datasources',
    title,
    description:
      'List datasources PUBLISHED to the connected site (LUID + contentUrl). Use to map a workbook connection to its published datasource, e.g. before generating insights for it.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (_args, extra): Promise<CallToolResult> => {
      return await listSiteDatasources.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          const sessionResult = resolveSession(undefined);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(listSiteDatasources.name).toErr();
          }

          const result = await executor.listSiteDatasources(extra.signal);
          if (result.isErr()) {
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            datasources: (result.value.datasources ?? []).map(projectDatasource),
          });
        },
      });
    },
  });

  return listSiteDatasources;
};

function projectDatasource(datasource: SiteDatasourceItem): {
  id?: string;
  luid?: string;
  name?: string;
  contentUrl?: string;
} {
  const contentUrl = (datasource as Record<string, unknown>)['contentUrl'];
  return {
    ...(datasource.id !== undefined ? { id: datasource.id } : {}),
    ...(datasource.luid !== undefined ? { luid: datasource.luid } : {}),
    ...(datasource.name !== undefined ? { name: datasource.name } : {}),
    ...(typeof contentUrl === 'string' ? { contentUrl } : {}),
  };
}
