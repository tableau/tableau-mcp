import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { BoundedContext } from '../../overridableConfig.js';
import { useRestApi } from '../../restApiInstance.js';
import { CustomView } from '../../sdks/tableau/types/customView.js';
import { Server } from '../../server.js';
import { getConfigWithOverrides } from '../../utils/mcpSiteSettings.js';
import { paginate } from '../../utils/paginate.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { ConstrainedResult, Tool } from '../tool.js';
import { TableauRequestHandlerExtra } from '../toolContext.js';
import { parseAndValidateCustomViewsFilterString } from './customViewsFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  limit: z.number().gt(0).optional(),
};

export const getListCustomViewsTool = (server: Server): Tool<typeof paramsSchema> => {
  const listCustomViewsTool = new Tool({
    server,
    name: 'list-custom-views',
    description: `
  Retrieves a list of custom views on a Tableau site including their metadata such as name, owner, and the view and workbook they are found in. Supports optional filtering via field:operator:value expressions (e.g., name:eq:Overview) for precise and flexible view discovery. Use this tool when a user requests to list, search, or filter Tableau customviews on a site.

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
  | workbookId          | eq                   |

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
    callback: async ({ filter, pageSize, limit }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const validatedFilter = filter ? parseAndValidateCustomViewsFilterString(filter) : undefined;

      return await listCustomViewsTool.logAndExecute({
        extra,
        args: {},
        callback: async () => {
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
        constrainSuccessResult: async (customViews) =>
          await constrainCustomViews({
            customViews,
            boundedContext: configWithOverrides.boundedContext,
            extra,
          }),
      });
    },
  });

  return listCustomViewsTool;
};

export async function constrainCustomViews({
  customViews,
  boundedContext,
  extra,
}: {
  customViews: Array<CustomView>;
  boundedContext: BoundedContext;
  extra: TableauRequestHandlerExtra;
}): Promise<ConstrainedResult<Array<CustomView>>> {
  if (customViews.length === 0) {
    return {
      type: 'empty',
      message:
        'No custom views were found. Either none exist or you do not have permission to view them.',
    };
  }

  const { workbookIds, projectIds, tags } = boundedContext;
  if (workbookIds) {
    customViews = customViews.filter((customView) =>
      customView.workbook?.id ? workbookIds.has(customView.workbook.id) : false,
    );
  }

  if (!projectIds && !tags) {
    // If project and tag filtering are not enabled, there's no need to iterate over the custom views
    // to determine whether each one is allowed.
    return {
      type: 'success',
      result: customViews,
    };
  }

  // TODO: Remove this once the tool requires a workbook id
  const filteredCustomViews: Array<CustomView> = [];
  // The list of custom views could be very large and determining whether each one is allowed requires
  // querying for the underlying view's metadata.
  for (const customView of customViews) {
    const { allowed } = await resourceAccessChecker.isCustomViewAllowed({
      customView,
      extra,
    });

    if (allowed) {
      filteredCustomViews.push(customView);
    }
  }

  if (filteredCustomViews.length === 0) {
    return {
      type: 'empty',
      message: [
        'The set of allowed views that can be queried is limited by the server configuration.',
        'While views were found, they were all filtered out by the server configuration.',
      ].join(' '),
    };
  }

  return {
    type: 'success',
    result: filteredCustomViews,
  };
}
