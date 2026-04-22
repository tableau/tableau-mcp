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
import { WebTool } from '../tool.web.js';
import { parseAndValidateCustomViewsFilterString } from './customViewsFilterUtils.js';

const paramsSchema = {
  workbookId: z.string().min(1),
  filter: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  limit: z.number().gt(0).optional(),
};

export const getListCustomViewsTool = (server: Server): WebTool<typeof paramsSchema> => {
  const listCustomViewsTool = new WebTool({
    server,
    name: 'list-custom-views',
    // workbookId intentionally omitted from the filter field table since it originates from the workbookId parameter
    description: `
  Retrieves a list of custom views for a Tableau workbook including their metadata such as name, owner, and the view they are found in. Supports optional filtering via field:operator:value expressions (e.g., viewId:eq:<view_id>) for precise and flexible custom view discovery. The tool always includes the workbookId in the final filter expression based on the required workbookId argument. Including the workbookId field in the filter will be ignored. Use this tool when a user requests to list, search, or filter Tableau custom views for a workbook.

  **Supported Filter Fields and Operators**
  | Field               | Operators            |
  |---------------------|----------------------|
  | ownerId             | eq                   |
  | viewId              | eq                   |

  ${genericFilterDescription}

  **Example Usage:**
  - List all custom views for a given workbook:
      workbookId: "222ea993-9391-4910-a167-56b3d19b4e3b"
  - List custom views from the view with viewId "9460abfe-a6b2-49d1-b998-39e1ebcc55ce":
      workbookId: "222ea993-9391-4910-a167-56b3d19b4e3b"
      filter: "viewId:eq:9460abfe-a6b2-49d1-b998-39e1ebcc55ce"
  - List custom views for the owner with ownerId "bbdee366-4a50-4c2c-a5c8-746da5b64483":
      workbookId: "222ea993-9391-4910-a167-56b3d19b4e3b"
      filter: "ownerId:eq:bbdee366-4a50-4c2c-a5c8-746da5b64483"`,
    paramsSchema,
    annotations: {
      title: 'List Custom Views',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ workbookId, filter, pageSize, limit }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();

      if (filter?.includes('workbookId:')) {
        // Remove any workbookId filter since the source of truth comes from the workbookId argument.
        filter = filter
          .split(',')
          .filter((f) => !f.startsWith('workbookId:'))
          .join(',');
      }

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
