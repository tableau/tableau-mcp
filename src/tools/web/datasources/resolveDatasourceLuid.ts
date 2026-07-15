import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError, DatasourceNotAllowedError } from '../../../errors/mcpToolError.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  contentUrl: z.string().nonempty(),
};

export const getResolveDatasourceLuidTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'resolve-datasource-luid',
    description:
      'Resolve a published datasource LUID by exact, case-sensitive datasource contentUrl match.',
    paramsSchema,
    annotations: {
      title: 'Resolve Datasource LUID',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ contentUrl }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { contentUrl },
        callback: async () =>
          await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const response = await restApi.datasourcesMethods.listDatasources({
                siteId: restApi.siteId,
                filter: `contentUrl:eq:${contentUrl}`,
                pageSize: 100,
                pageNumber: 1,
              });

              const exact = response.datasources.find((d) => d.contentUrl === contentUrl);
              if (!exact) {
                return new ArgsValidationError(
                  `No datasource matched contentUrl "${contentUrl}"`,
                ).toErr();
              }

              // Do not return identity (LUID/name) for a datasource outside the
              // server's bounded context — otherwise this is an existence/LUID
              // oracle and feeds unguarded LUIDs into generate-insight-cards.
              const datasourceAllowed = await resourceAccessChecker.isDatasourceAllowed({
                datasourceLuid: exact.id,
                extra,
              });
              if (!datasourceAllowed.allowed) {
                return new DatasourceNotAllowedError(datasourceAllowed.message).toErr();
              }

              return Ok({
                id: exact.id,
                name: exact.name,
                contentUrl: exact.contentUrl ?? contentUrl,
              });
            },
          }),
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return tool;
};
