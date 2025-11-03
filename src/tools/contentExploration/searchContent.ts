import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import {
  orderBySchema,
  searchContentFilterSchema,
} from '../../sdks/tableau/types/contentExploration.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';
import {
  buildFilterString,
  buildOrderByString,
  constrainSearchContent,
  ReducedSearchContentResponse,
  reduceSearchContentResponse,
} from './searchContentUtils.js';

const paramsSchema = {
  terms: z.string().trim().nonempty().optional(),
  limit: z.number().int().min(1).max(2000).default(100).optional(),
  orderBy: orderBySchema.optional(),
  filter: searchContentFilterSchema.optional(),
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

- \`limit\` (optional): The number of items to return in the search response (default: 100, max: 2000)

- \`orderBy\` (optional): Determines the sorting method for returned items. Available sorting methods:
  - \`hitsTotal\`: Number of times a content item has been viewed since it was created
  - \`hitsSmallSpanTotal\`: Number of times a content item was viewed in the last month
  - \`hitsMediumSpanTotal\`: Number of times a content item was viewed in the last 3 months
  - \`hitsLargeSpanTotal\`: Number of times a content item was viewed in the last year
  - \`downstreamWorkbookCount\`: Number of workbooks in a given project. This value is only available when the content type filter includes 'database' or 'table'
  
  For each sort method, you can specify a sort direction: 'asc' for ascending or 'desc' for descending (default: 'asc'). The orderBy parameter is an array of objects containing the sorting method and direction. The first element determines primary sorting, with subsequent elements used as tiebreakers.

**Important Notes:**
- If \`orderBy\` is omitted, the search will sort items by their "relevance score" in descending order, which is Tableau's internal algorithm for providing the most relevant results`,
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
      return await searchContentTool.logAndExecute<Array<ReducedSearchContentResponse>>({
        requestId,
        args: {},
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:content:read'],
              callback: async (restApi) => {
                const response = await restApi.contentExplorationMethods.searchContent({
                  terms,
                  page: 0,
                  limit: config.maxResultLimit
                    ? Math.min(config.maxResultLimit, limit ?? 100)
                    : (limit ?? 100),
                  orderBy: orderByString,
                  filter: filterString,
                });
                return reduceSearchContentResponse(response);
              },
            }),
          );
        },
        constrainSuccessResult: (items) =>
          constrainSearchContent({ items, boundedContext: config.boundedContext }),
      });
    },
  });

  return searchContentTool;
};
