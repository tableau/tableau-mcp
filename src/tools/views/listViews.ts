import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/schemas.js';
import { paginate } from '../../utils/paginate.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { Tool } from '../tool.js';
import { parseAndValidateViewsFilterString } from './viewsFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  limit: z.number().gt(0).optional(),
};

export const getListViewsTool = (server: Server): Tool<typeof paramsSchema> => {
  const listViewsTool = new Tool({
    server,
    name: 'list-views',
    description: `
  Retrieves a list of views on a Tableau site including their metadata such as name, owner, and the workbook they are found in. Supports optional filtering via field:operator:value expressions (e.g., name:eq:Overview) for precise and flexible view discovery. Use this tool when a user requests to list, search, or filter Tableau views on a site.

  **Supported Filter Fields and Operators**
  | Field               | Operators            |
  |---------------------|----------------------|
  | caption             | eq, in               |
  | contentUrl          | eq, in               |
  | createdAt           | eq, gt, gte, lt, lte |
  | favoritesTotal      | eq, gt, gte, lt, lte |
  | fields              | eq, in               |
  | hitsTotal           | eq, gt, gte, lt, lte |
  | name                | eq, in               |
  | ownerDomain         | eq, in               |
  | ownerEmail          | eq, in               |
  | ownerName           | eq, in               |
  | projectName         | eq, in               |
  | sheetNumber         | eq, gt, gte, lt, lte |
  | sheetType           | eq, in               |
  | tags                | eq, in               |
  | title               | eq, in               |
  | updatedAt           | eq, gt, gte, lt, lte |
  | viewUrlname         | eq, in               |
  | workbookDescription | eq, in               |
  | workbookName        | eq, in               |

  ${genericFilterDescription}
  
  **Example Usage:**
  - List all views on a site
  - List views with the name "Overview":
      filter: "name:eq:Overview"
  - List views in the "Finance" project:
      filter: "projectName:eq:Finance"
  - List views created after January 1, 2023:
      filter: "createdAt:gt:2023-01-01T00:00:00Z"
  - List views with the name "Overview" in the "Finance" project and created after January 1, 2023:
      filter: "name:eq:Overview,projectName:eq:Finance,createdAt:gt:2023-01-01T00:00:00Z"`,
    paramsSchema,
    annotations: {
      title: 'List Views',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (
      { filter, pageSize, limit },
      { requestId, authInfo },
    ): Promise<CallToolResult> => {
      const config = getConfig();
      const validatedFilter = filter ? parseAndValidateViewsFilterString(filter) : undefined;

      return await listViewsTool.logAndExecute({
        requestId,
        authInfo,
        args: {},
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:content:read'],
              authInfo: getTableauAuthInfo(authInfo),
              callback: async (restApi) => {
                const workbooks = await paginate({
                  pageConfig: {
                    pageSize,
                    limit: config.maxResultLimit
                      ? Math.min(config.maxResultLimit, limit ?? Number.MAX_SAFE_INTEGER)
                      : limit,
                  },
                  getDataFn: async (pageConfig) => {
                    const { pagination, views: data } =
                      await restApi.viewsMethods.queryViewsForSite({
                        siteId: restApi.siteId,
                        filter: validatedFilter ?? '',
                        includeUsageStatistics: true,
                        pageSize: pageConfig.pageSize,
                        pageNumber: pageConfig.pageNumber,
                      });

                    return { pagination, data };
                  },
                });

                return workbooks;
              },
            }),
          );
        },
      });
    },
  });

  return listViewsTool;
};
