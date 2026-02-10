import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { BoundedContext, getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Workbook } from '../../sdks/tableau/types/workbook.js';
import { Server } from '../../server.js';
import { getTableauAuthInfo } from '../../server/oauth/getTableauAuthInfo.js';
import { createProductTelemetryBase } from '../../telemetry/productTelemetry/telemetryForwarder.js';
import { getRequiredApiScopesForTool } from '../../server/oauth/scopes.js';
import { paginate } from '../../utils/paginate.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { ConstrainedResult, Tool } from '../tool.js';
import { parseAndValidateWorkbooksFilterString } from './workbooksFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  limit: z.number().gt(0).optional(),
};

export const getListWorkbooksTool = (server: Server): Tool<typeof paramsSchema> => {
  const listWorkbooksTool = new Tool({
    server,
    name: 'list-workbooks',
    description: `
  Retrieves a list of workbooks on a Tableau site including their metadata such as name, description, and information about the views contained in the workbook. Supports optional filtering via field:operator:value expressions (e.g., name:eq:Superstore) for precise and flexible workbook discovery. Use this tool when a user requests to list, search, or filter Tableau workbooks on a site.

  **Supported Filter Fields and Operators**
  | Field             | Operators            |
  |-------------------|----------------------|
  | createdAt         | eq, gt, gte, lt, lte |
  | contentUrl        | eq, in               |
  | displayTabs       | eq                   |
  | favoritesTotal    | eq, gt, gte, lt, lte |
  | hasAlerts         | eq                   |
  | hasExtracts       | eq                   |
  | name              | eq, in               |
  | ownerDomain       | eq, in               |
  | ownerEmail        | eq, in               |
  | ownerName         | eq, in               |
  | projectName       | eq, in               |
  | sheetCount        | eq, gt, gte, lt, lte |
  | size              | eq, gt, gte, lt, lte |
  | subscriptionTotal | eq, gt, gte, lt, lte |
  | tags              | eq, in               |
  | updatedAt         | eq, gt, gte, lt, lte |

  ${genericFilterDescription}

  **Example Usage:**
  - List all workbooks on a site
  - List workbooks with the name "Superstore":
      filter: "name:eq:Superstore"
  - List workbooks in the "Finance" project:
      filter: "projectName:eq:Finance"
  - List workbooks created after January 1, 2023:
      filter: "createdAt:gt:2023-01-01T00:00:00Z"
  - List workbooks with the name "Superstore" in the "Finance" project and created after January 1, 2023:
      filter: "name:eq:Superstore,projectName:eq:Finance,createdAt:gt:2023-01-01T00:00:00Z"`,
    paramsSchema,
    annotations: {
      title: 'List Workbooks',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (
      { filter, pageSize, limit },
      { requestId, sessionId, authInfo, signal },
    ): Promise<CallToolResult> => {
      const config = getConfig();
      const validatedFilter = filter ? parseAndValidateWorkbooksFilterString(filter) : undefined;

      return await listWorkbooksTool.logAndExecute({
        requestId,
        sessionId,
        authInfo,
        args: {},
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: getRequiredApiScopesForTool('list-workbooks'),
              signal,
              authInfo: getTableauAuthInfo(authInfo),
              callback: async (restApi) => {
                const maxResultLimit = config.getMaxResultLimit(listWorkbooksTool.name);
                const workbooks = await paginate({
                  pageConfig: {
                    pageSize,
                    limit: maxResultLimit
                      ? Math.min(maxResultLimit, limit ?? Number.MAX_SAFE_INTEGER)
                      : limit,
                  },
                  getDataFn: async (pageConfig) => {
                    const { pagination, workbooks: data } =
                      await restApi.workbooksMethods.queryWorkbooksForSite({
                        siteId: restApi.siteId,
                        filter: validatedFilter ?? '',
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
        constrainSuccessResult: (workbooks) =>
          constrainWorkbooks({ workbooks, boundedContext: config.boundedContext }),
        productTelemetryBase: createProductTelemetryBase(config, authInfo),
      });
    },
  });

  return listWorkbooksTool;
};

export function constrainWorkbooks({
  workbooks,
  boundedContext,
}: {
  workbooks: Array<Workbook>;
  boundedContext: BoundedContext;
}): ConstrainedResult<Array<Workbook>> {
  if (workbooks.length === 0) {
    return {
      type: 'empty',
      message:
        'No workbooks were found. Either none exist or you do not have permission to view them.',
    };
  }

  const { projectIds, workbookIds, tags } = boundedContext;
  if (projectIds) {
    workbooks = workbooks.filter((workbook) =>
      workbook.project?.id ? projectIds.has(workbook.project.id) : false,
    );
  }

  if (workbookIds) {
    workbooks = workbooks.filter((workbook) => workbookIds.has(workbook.id));
  }

  if (tags) {
    workbooks = workbooks.filter((workbook) =>
      workbook.tags?.tag?.some((tag) => tags.has(tag.label)),
    );
  }

  if (workbooks.length === 0) {
    return {
      type: 'empty',
      message: [
        'The set of allowed workbooks that can be queried is limited by the server configuration.',
        'While workbooks were found, they were all filtered out by the server configuration.',
      ].join(' '),
    };
  }

  return {
    type: 'success',
    result: workbooks,
  };
}
