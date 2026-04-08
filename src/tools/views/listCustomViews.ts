import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WorkbookNotAllowedError } from '../../errors/mcpToolError.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { paginate } from '../../utils/paginate.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { Tool } from '../tool.js';
import { parseAndValidateCustomViewsFilterString } from './customViewsFilterUtils.js';

const paramsSchema = {
  workbookId: z.string().min(1),
  filter: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  limit: z.number().gt(0).optional(),
};

export const getListCustomViewsTool = (server: Server): Tool<typeof paramsSchema> => {
  const listCustomViewsTool = new Tool({
    server,
    name: 'list-custom-views',
    description: `
  Retrieves a list of custom views for a Tableau workbook including their metadata such as name, owner, and the view they are found in. Supports optional filtering via field:operator:value expressions (e.g., name:eq:Overview) for precise and flexible view discovery. Use this tool when a user requests to list, search, or filter Tableau custom views for a workbook.

  **Supported Filter Fields and Operators**
  | Field               | Operators            |
  |---------------------|----------------------|
  | createdAt           | eq, gt, gte, lt, lte |
  | id                  | eq, in               |
  | name                | eq, in               |
  | ownerId             | eq                   |
  | shared              | eq                   |
  | updatedAt           | eq, gt, gte, lt, lte |
  | viewId              | eq                   |

  ${genericFilterDescription}

  **Example Usage:**
  - List all custom views on a site
  - List custom views with the name "Overview":
      filter: "name:eq:Overview"
  - List custom views in the view with a specific ID:
      filter: "viewId:eq:4d18c547-bbb1-4187-ae5a-7f78b35adf2d"
  - List custom views created after January 1, 2023:
      filter: "createdAt:gt:2023-01-01T00:00:00Z"
  - List custom views with the name "Overview" and created after January 1, 2023:
      filter: "name:eq:Overview,createdAt:gt:2023-01-01T00:00:00Z"`,
    paramsSchema,
    annotations: {
      title: 'List Custom Views',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ workbookId, filter, pageSize, limit }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      const filterString = filter
        ? `workbookId:eq:${workbookId},${filter}`
        : `workbookId:eq:${workbookId}`;

      const validatedFilter = parseAndValidateCustomViewsFilterString(filterString);

      return await listCustomViewsTool.logAndExecute({
        extra,
        args: { workbookId },
        callback: async () => {
          const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
            workbookId,
            extra,
          });

          if (!isWorkbookAllowedResult.allowed) {
            return new WorkbookNotAllowedError(isWorkbookAllowedResult.message).toErr();
          }

          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: listCustomViewsTool.requiredApiScopes,
              callback: async (restApi) => {
                const maxResultLimit = configWithOverrides.getMaxResultLimit(
                  listCustomViewsTool.name,
                );

                const customViews = await paginate({
                  pageConfig: {
                    pageSize,
                    limit: maxResultLimit
                      ? Math.min(maxResultLimit, limit ?? Number.MAX_SAFE_INTEGER)
                      : limit,
                  },
                  getDataFn: async (pageConfig) => {
                    const { pagination, customViews: data } =
                      await restApi.viewsMethods.listCustomViews({
                        siteId: restApi.siteId,
                        filter: validatedFilter ?? '',
                        pageSize: pageConfig.pageSize,
                        pageNumber: pageConfig.pageNumber,
                      });

                    return { pagination, data };
                  },
                });

                return customViews;
              },
            }),
          );
        },
        constrainSuccessResult: async (customViews) => {
          return {
            type: 'success',
            result: customViews,
          };
        },
      });
    },
  });

  return listCustomViewsTool;
};
