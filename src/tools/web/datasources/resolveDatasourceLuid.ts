import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
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
  const config = getConfig();
  const tool = new WebTool({
    server,
    name: 'resolve-datasource-luid',
    description:
      'Resolve a published datasource LUID by exact, case-sensitive datasource contentUrl match.',
    // Gated off by default (INSIGHTS_TOOLS_ENABLED) alongside generate-insight-cards.
    disabled: !config.insightsToolsEnabled,
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
              // Return an IDENTICAL error for "absent" and "exists but outside the
              // bounded context" so a caller cannot enumerate which non-allowed
              // datasources exist (404-style, not 403 — the distinction itself is
              // an existence oracle). Only run the allow-list check when a match
              // exists (we need its LUID), and collapse both denials to one error.
              const allowed =
                !!exact &&
                (
                  await resourceAccessChecker.isDatasourceAllowed({
                    datasourceLuid: exact.id,
                    extra,
                  })
                ).allowed;
              if (!exact || !allowed) {
                return new ArgsValidationError(
                  `No datasource matched contentUrl "${contentUrl}"`,
                ).toErr();
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
