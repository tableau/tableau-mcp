import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Group } from '../../../sdks/tableau/types/group.js';
import { MIN_ADMIN_SITE_ROLE } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { paginateWithMetadata } from '../../../utils/paginate.js';
import { assertAdmin } from '../adminGate.js';
import { ConstrainedResult, WebTool } from '../tool.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
};

export const getListGroupsTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const config = getConfig();

  const listGroupsTool = new WebTool({
    server,
    name: 'list-groups',
    minRequiredRole: MIN_ADMIN_SITE_ROLE,
    disabled: !config.adminToolsEnabled,
    description: `
  Retrieves a list of groups on the Tableau site. Each group includes its ID, name, and domain name.

  Use this tool when you need to:
  - Discover which groups exist on the site
  - Look up a group's ID by name
  - Check whether a group already exists before referring to it

  **Parameters:**
  - \`filter\` (optional) – A Tableau REST API filter expression with format \`field:operator:value\` (for example \`name:eq:Sales\`). The filter is applied by Tableau, not by this tool. Multiple expressions are comma-separated.
  - \`pageSize\` (optional) – Number of groups to fetch from the API per page (default 100, max 1000).
  - \`limit\` (optional) – Maximum number of groups to return.

  **Response:** A JSON object \`{ groups: [...], totalAvailable: number, truncated: boolean }\`. Each group in \`groups\` includes:
  - \`id\` – group ID
  - \`name\` – group name
  - \`domain.name\` – domain of the group (\`local\` for local groups)

  \`totalAvailable\` is the number of groups Tableau reports for the request. \`truncated\` is \`true\` when a \`limit\` (or a configured result limit) cut the list short, so \`groups\` is only a partial list. Do not report a truncated list as complete.
  `,
    paramsSchema,
    annotations: {
      title: 'List Groups',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      return await listGroupsTool.logAndExecute<ListGroupsToolResult>({
        extra,
        args,
        callback: async () => {
          const result = await useRestApi({
            ...extra,
            jwtScopes: listGroupsTool.requiredApiScopes,
            callback: async (restApi) => {
              const adminResult = await assertAdmin(restApi, extra);
              if (adminResult.isErr()) {
                throw new Error(adminResult.error);
              }

              // The tighter of the caller's limit and any admin-configured MAX_RESULT_LIMITS wins.
              const maxResultLimit = configWithOverrides.getMaxResultLimit(listGroupsTool.name);
              const limits = [args.limit, maxResultLimit].filter(
                (limit): limit is number => limit != null,
              );
              const limit = limits.length > 0 ? Math.min(...limits) : undefined;

              const { items, totalAvailable, truncatedByLimit } = await paginateWithMetadata<Group>(
                {
                  pageConfig: { pageSize: args.pageSize, limit },
                  getDataFn: async (pageConfig) => {
                    const { groups, pagination } = await restApi.usersMethods.listGroups({
                      siteId: restApi.siteId,
                      pageSize: pageConfig.pageSize,
                      pageNumber: pageConfig.pageNumber,
                      filter: args.filter,
                    });

                    return {
                      pagination: pagination ?? {
                        pageNumber: pageConfig.pageNumber ?? 1,
                        pageSize: pageConfig.pageSize ?? 100,
                        totalAvailable: groups.length,
                      },
                      data: groups,
                    };
                  },
                },
              );

              return { groups: items, totalAvailable, truncated: truncatedByLimit };
            },
          });

          return new Ok(result);
        },
        constrainSuccessResult: (toolResult) => constrainGroups(toolResult),
      });
    },
  });

  return listGroupsTool;
};

interface ListGroupsToolResult {
  groups: Array<Group>;
  totalAvailable: number;
  truncated: boolean;
}

export function constrainGroups(
  result: ListGroupsToolResult,
): ConstrainedResult<ListGroupsToolResult> {
  if (result.groups.length === 0) {
    return {
      type: 'empty',
      message:
        'No groups were found. Either none exist or you do not have permission to view them.',
    };
  }

  return { type: 'success', result };
}
