import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import {
  OrderBySchema,
  SearchContentFilterSchema,
} from '../../sdks/tableau/types/contentExploration.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import {
  buildFilterString,
  buildOrderByString,
  reduceSearchContentResponse,
} from './searchContentUtils.js';

const paramsSchema = {
  terms: z.string().trim().nonempty().optional(),
  limit: z.number().int().min(1).max(2000).default(2000).optional(),
  orderBy: OrderBySchema.optional(),
  filter: SearchContentFilterSchema.optional(),
};

export const getSearchContentTool = (server: Server): Tool<typeof paramsSchema> => {
  const searchContentTool = new Tool({
    server,
    name: 'search-content',
    description: `
This tool searches across all supported content types for objects relevant to the search expression specified by search terms and filters.

**Parameters:**

- \`terms\` (optional): A string containing one or more search terms that the search uses as the basis for determining which items are relevant to return. If the terms parameter is not provided, it searches for everything bound by the specified filters.

- \`filter\` (optional): Allows you to limit search results based on:
  - \`contentTypes\`: Filter by content types. Supported types are: 'lens', 'datasource', 'virtualconnection', 'collection', 'project', 'flow', 'datarole', 'table', 'database', 'view', 'workbook'
  - \`ownerIds\`: Filter by specific owner IDs (array of integers)
  - \`modifiedTime\`: Filter by last modified times using ISO 8601 date-time strings. Can be either a range (with startDate/endDate) or an array of specific date-times to include

- \`limit\` (optional): The number of items to return in the search response (default: 2000, max: 2000)

- \`orderBy\` (optional): Determines the sorting method for returned items. Available sorting methods:
  - \`hitsTotal\`: Number of times a content item has been viewed since it was created
  - \`hitsSmallSpanTotal\`: Number of times a content item was viewed in the last month
  - \`hitsMediumSpanTotal\`: Number of times a content item was viewed in the last 3 months
  - \`hitsLargeSpanTotal\`: Number of times a content item was viewed in the last year
  - \`downstreamWorkbookCount\`: Number of workbooks in a given project (requires content type filter of 'database' or 'table')
  
  For each sort method, you can specify a sort direction: 'asc' for ascending or 'desc' for descending (default: 'asc'). The orderBy parameter is an array of objects containing the sorting method and direction. The first element determines primary sorting, with subsequent elements used as tiebreakers.

**Important Notes:**
- If \`orderBy\` is omitted, the search will sort items by their "relevance score" in descending order, which is Tableau's internal algorithm for providing the most relevant results
- When using 'downstreamWorkbookCount' as a sorting method, you must filter the content type to 'database' or 'table'`,
    paramsSchema,
    annotations: {
      title: 'Search Content',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ terms, limit, orderBy, filter }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();
      const orderByString = orderBy ? buildOrderByString(orderBy) : undefined;
      const filterString = filter ? buildFilterString(filter) : undefined;
      if (
        orderByString?.includes('downstreamWorkbookCount') &&
        !filterString?.includes('type:eq:table') &&
        !filterString?.includes('type:eq:database')
      ) {
        throw new Error(
          "When 'orderBy' includes 'downstreamWorkbookCount', the filter must include of content type of 'table' or 'database'",
        );
      }

      return await searchContentTool.logAndExecute({
        requestId,
        args: {},
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: [],
              callback: async (restApi) => {
                const response = await restApi.contentExplorationMethods.searchContent({
                  terms,
                  page: 0,
                  limit: limit ?? 2000, // TODO: determine default limit
                  orderBy: orderByString,
                  filter: filterString,
                });
                return reduceSearchContentResponse(response);
              },
            }),
          );
        },
      });
    },
  });

  return searchContentTool;
};
