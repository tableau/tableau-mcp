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
import { Workbook } from '../../../sdks/tableau/types/workbook.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { getPage, MAX_PAGE_SIZE } from '../../../utils/paginate.js';
import { genericFilterDescription } from '../genericFilterDescription.js';
import { ConstrainedResult, WebTool } from '../tool.js';
import { parseAndValidateWorkbooksFilterString } from './workbooksFilterUtils.js';

const paramsSchema = {
  filter: z.string().optional(),
  pageNumber: z
    .number()
    .int()
    .gt(0)
    .optional()
    .describe('Which 1000-item page to fetch (1-based, default 1).'),
  limit: z
    .number()
    .int()
    .gt(0)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(
      'The maximum number of workbooks to return from the requested page (must be <= 1000). Use this to fetch fewer than a full page, e.g. the final partial page a client wants.',
    ),
};

export const getListWorkbooksTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const listWorkbooksTool = new WebTool({
    server,
    name: 'list-workbooks',
    description: `
  Retrieves a list of workbooks on a Tableau site including their metadata such as name, description, and information about the views contained in the workbook. Supports optional filtering via field:operator:value expressions (e.g., name:eq:Superstore) for precise and flexible workbook discovery. Use this tool when a user requests to list, search, or filter Tableau workbooks on a site.

  This tool returns a single 1000-item page per call. Use \`pageNumber\` to select which 1000-item page to fetch (1-based, default 1). The response is a flat object \`{ data, totalAvailable }\`; paginate by incrementing \`pageNumber\` until you have collected \`totalAvailable\` items.

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
    callback: async ({ filter, pageNumber, limit }, extra): Promise<CallToolResult> => {
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

                const page = await getPage({
                  pageNumber,
                  limit,
                  maxResultLimit,
                  getDataFn: async ({ pageSize, pageNumber }) => {
                    const { pagination, workbooks: data } =
                      await restApi.workbooksMethods.queryWorkbooksForSite({
                        siteId: restApi.siteId,
                        filter: validatedFilter ?? '',
                        pageSize,
                        pageNumber,
                      });

                    return { pagination, data };
                  },
                });

                const workbooks = page.data;

                if (configWithOverrides.disableMetadataApiRequests || workbooks.length === 0) {
                  return { ...page, data: workbooks };
                }

                try {
                  const response = await restApi.metadataMethods.graphql(
                    getWorkbookLineageQuery(workbooks.map((workbook) => workbook.id)),
                  );
                  const enriched = mergeWorkbookLineage(
                    workbooks,
                    getWorkbookLineageByLuid(response),
                    configWithOverrides.boundedContext.datasourceIds,
                  );
                  return { ...page, data: enriched };
                } catch (error) {
                  log({
                    message: 'Failed to enrich workbooks with lineage metadata',
                    level: 'warning',
                    logger: 'lineage',
                    data: getExceptionMessage(error),
                  });
                  return { ...page, data: workbooks };
                }
              },
            }),
          );
        },
        constrainSuccessResult: (page) => {
          const constrained = constrainWorkbooks({
            workbooks: page.data,
            boundedContext: configWithOverrides.boundedContext,
          });

          if (constrained.type !== 'success') {
            return constrained;
          }

          return {
            type: 'success',
            result: {
              data: constrained.result,
              totalAvailable: page.totalAvailable,
            },
          };
        },
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
