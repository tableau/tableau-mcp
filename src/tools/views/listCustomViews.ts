import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { CustomViewNotAllowedError, WorkbookNotFoundError } from '../../errors/mcpToolError.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
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
    // workbookId intentionally omitted from the filter field table since it originates from the workbookId parameter
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

      const filters = [`workbookId:eq:${workbookId}`, ...(filter ? [filter] : [])].join(',');
      const validatedFilter = parseAndValidateCustomViewsFilterString(filters);

      return await listCustomViewsTool.logAndExecute({
        extra,
        args: { workbookId },
        callback: async () => {
          const isWorkbookAllowedResult = await resourceAccessChecker.isWorkbookAllowed({
            workbookId,
            extra,
          });

          if (!isWorkbookAllowedResult.allowed) {
            // The workbook is not allowed to be queried,
            // so the custom views for that workbook are not allowed to be queried either.
            return new CustomViewNotAllowedError(
              [
                `The custom views from the workbook with LUID ${workbookId} are not allowed to be queried.`,
                isWorkbookAllowedResult.message,
              ].join(' '),
            ).toErr();
          }

          let workbook = isWorkbookAllowedResult.content;

          return await useRestApi({
            ...extra,
            jwtScopes: listCustomViewsTool.requiredApiScopes,
            callback: async (restApi) => {
              if (!workbook) {
                try {
                  workbook = await restApi.workbooksMethods.getWorkbook({
                    workbookId,
                    siteId: restApi.siteId,
                  });
                } catch (error) {
                  return new WorkbookNotFoundError(
                    [
                      `The workbook with LUID ${workbookId} was not found.`,
                      getExceptionMessage(error),
                    ].join(' '),
                  ).toErr();
                }
              }

              if (!workbook) {
                return new WorkbookNotFoundError(
                  `The workbook with LUID ${workbookId} was not found.`,
                ).toErr();
              }

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

              return Ok(customViews);
            },
          });
        },
        constrainSuccessResult: async (customViews) => {
          // The custom views do not need to be further constrained since they are already constrained by the workbook.
          // Workbook filtering was already handled by the tool itself.
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
