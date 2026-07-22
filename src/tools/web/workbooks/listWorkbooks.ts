import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { log } from '../../../logging/logger.js';
import { BoundedContext } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  getWorkbookLineageByLuid,
  getWorkbookLineageQuery,
  mergeWorkbookLineage,
} from '../../../sdks/tableau/methods/lineageUtils.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { Workbook } from '../../../sdks/tableau/types/workbook.js';
import { WebMcpServer } from '../../../server.web.js';
import { isAxiosError } from '../../../utils/axios.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { paginate } from '../../../utils/paginate.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { parseAndValidateWorkbooksFilterString } from './workbooksFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  limit: z.number().gt(0).optional(),
};

export const getListWorkbooksTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const listWorkbooksTool = new WebTool({
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
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ filter, pageSize, limit }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const validatedFilter = filter ? parseAndValidateWorkbooksFilterString(filter) : undefined;

      return await listWorkbooksTool.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: listWorkbooksTool.requiredApiScopes,
              callback: async (restApi) => {
                const maxResultLimit = configWithOverrides.getMaxResultLimit(
                  listWorkbooksTool.name,
                );
                const effectiveLimit = maxResultLimit
                  ? Math.min(maxResultLimit, limit ?? Number.MAX_SAFE_INTEGER)
                  : limit;

                // Fast path: when results are scoped to a specific set of workbook IDs and the user
                // hasn't supplied a filter, fetch those workbooks directly instead of paging the
                // whole site. Query Workbooks for Site has no workbook-ID filter, so the slow path
                // would fetch every workbook only to discard all but the allowed ones. A user filter
                // forces the slow path since Query Workbook can't apply server-side filtering.
                const workbookIds = configWithOverrides.boundedContext.workbookIds;
                const workbooks =
                  workbookIds !== null && !filter
                    ? await fetchAllowedWorkbooksById({
                        restApi,
                        workbookIds,
                        limit: effectiveLimit,
                      })
                    : await paginate({
                        pageConfig: {
                          pageSize,
                          limit: effectiveLimit,
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

                if (configWithOverrides.disableMetadataApiRequests || workbooks.length === 0) {
                  return workbooks;
                }

                try {
                  const response = await restApi.metadataMethods.graphql(
                    getWorkbookLineageQuery(workbooks.map((workbook) => workbook.id)),
                  );
                  return mergeWorkbookLineage(
                    workbooks,
                    getWorkbookLineageByLuid(response),
                    configWithOverrides.boundedContext.datasourceIds,
                  );
                } catch (error) {
                  log({
                    message: 'Failed to enrich workbooks with lineage metadata',
                    level: 'warning',
                    logger: 'lineage',
                    data: getExceptionMessage(error),
                  });
                  return workbooks;
                }
              },
            }),
          );
        },
        constrainSuccessResult: (workbooks) =>
          constrainWorkbooks({ workbooks, boundedContext: configWithOverrides.boundedContext }),
      });
    },
  });

  return listWorkbooksTool;
};

/**
 * Fetches the allowed workbooks directly via Query Workbook, one request per ID. Used when the
 * results are scoped by `INCLUDE_WORKBOOK_IDS` and no user filter is present.
 *
 * Workbooks that return 403 (no permission) or 404 (deleted / not found) are silently omitted so the
 * result matches the slow path, where such workbooks simply never appear in Query Workbooks for
 * Site. Any other failure (5xx, network, etc.) propagates so genuine errors aren't hidden.
 *
 * All workbooks are fetched before slicing to `limit` so that omitted (403/404) workbooks are
 * backfilled by other allowed workbooks rather than leaving the result short.
 */
async function fetchAllowedWorkbooksById({
  restApi,
  workbookIds,
  limit,
}: {
  restApi: RestApi;
  workbookIds: Set<string>;
  limit: number | undefined;
}): Promise<Array<Workbook>> {
  const ids = [...workbookIds];
  const results = await Promise.allSettled(
    ids.map((workbookId) =>
      restApi.workbooksMethods.getWorkbook({
        siteId: restApi.siteId,
        workbookId,
      }),
    ),
  );

  const workbooks: Array<Workbook> = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      workbooks.push(result.value);
      return;
    }

    const status = isAxiosError(result.reason) ? result.reason.response?.status : undefined;
    if (status === 403 || status === 404) {
      log({
        message: `Skipping workbook ${ids[i]} from INCLUDE_WORKBOOK_IDS: not accessible (HTTP ${status})`,
        level: 'warning',
        logger: 'list-workbooks',
      });
      return;
    }

    throw result.reason;
  });

  return limit !== undefined ? workbooks.slice(0, limit) : workbooks;
}

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
