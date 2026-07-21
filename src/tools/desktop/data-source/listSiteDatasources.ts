import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ExternalApiToolExecutor } from '../../../desktop/externalApi/externalApiToolExecutor.js';
import { endpointNotInThisBuild, isRouteMissing } from '../../../desktop/externalApi/toolUtils.js';
import { SiteDatasourceItem } from '../../../desktop/externalApi/types.js';
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

const title = 'List Site Datasources';
export const getListSiteDatasourcesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listSiteDatasources = new DesktopTool({
    server,
    name: 'list-site-datasources',
    title,
    description:
      'List datasources PUBLISHED to the connected site (LUID; contentUrl when build provides it). Map workbook connections to published datasource LUIDs.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await listSiteDatasources.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const executor = await extra.getExecutor(sessionResult.value);
          if (!(executor instanceof ExternalApiToolExecutor)) {
            return new ExternalApiRequiredError(listSiteDatasources.name).toErr();
          }

          const result = await executor.listSiteDatasources(extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('site datasources').toErr();
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
