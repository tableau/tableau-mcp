import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { log } from '../../../logging/logger.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  filterLineageContentsByAllowedIds,
  getSearchContentLineageQuery,
  getViewLineageByLuid,
  getWorkbookLineageByLuid,
} from '../../../sdks/tableau/methods/lineageUtils.js';
import {
  orderBySchema,
  searchContentFilterSchema,
} from '../../../sdks/tableau/types/contentExploration.js';
import { WebMcpServer } from '../../../server.web.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { WebTool } from '../tool.js';
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

export const getSearchContentTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const searchContentTool = new WebTool({
    server,
    name: 'search-content',
    description: `
This tool searches and ranks Tableau content across many content types at once — including workbooks, views, datasources, projects, lenses, flows, tables, databases, virtual connections, data roles, and collections.
Use this tool for keyword or free-text discovery: when you want to find content by name or topic, when you do not know which content type an item is, when you want to search several content types in a single call, or when you want the most relevant or most-viewed items surfaced first.
It returns a single ranked page (the top N matches — default 100, max 2000) rather than an exhaustive enumeration of every match, so it is best suited to finding the most relevant items rather than returning every matching item.

**Parameters:**

- \`terms\` (optional): A string containing one or more search terms that the search uses as the basis for determining which items are relevant to return.

- \`filter\` (optional): Allows you to limit search results based on:
  - \`contentTypes\`: Filter by content types. Supported types are: 'lens', 'datasource', 'virtualconnection', 'collection', 'project', 'flow', 'datarole', 'table', 'database', 'view', 'workbook'
  - \`ownerIds\`: Filter by specific owner IDs (array of integers)
  - \`modifiedTime\`: Filter by last modified times using ISO 8601 date-time strings. Can be either a range (with startDate/endDate) or an array of specific date-times to include

- \`limit\` (optional): The maximum number of items to return in the search response (default: 100, max: 2000).

- \`orderBy\` (optional): An array of \`{ method, sortDirection }\` objects that controls how results are sorted. If omitted, results are sorted by their "relevance score" in descending order — Tableau's internal ranking of how well each item matches your search terms. \`sortDirection\` is 'asc' (ascending) or 'desc' (descending) and defaults to 'asc'. The first element is the primary sort; any additional elements are tiebreakers, applied in order. Available sorting methods:
  - \`hitsTotal\`: Number of times a content item has been viewed since it was created
  - \`hitsSmallSpanTotal\`: Number of times a content item was viewed in the last month
  - \`hitsMediumSpanTotal\`: Number of times a content item was viewed in the last 3 months
  - \`hitsLargeSpanTotal\`: Number of times a content item was viewed in the last year
  - \`downstreamWorkbookCount\`: Number of workbooks in a given project. This value is only available when the content type filter includes 'database' or 'table'

**Example Usage:**

- Top 5 most-viewed workbooks (all time): \`{ limit: 5, filter: { contentTypes: ["workbook"] }, orderBy: [{ method: "hitsTotal", sortDirection: "desc" }] }\`
- Free-text search for the most relevant content: \`{ terms: "quarterly sales" }\`
- Find only workbooks and views matching a topic: \`{ terms: "revenue", filter: { contentTypes: ["workbook", "view"] } }\`
- Surface the most-viewed datasources this month (no search terms): \`{ filter: { contentTypes: ["datasource"] }, orderBy: [{ method: "hitsSmallSpanTotal", sortDirection: "desc" }] }\`
- Multi-key sort — most-viewed all-time first, using views this year as a tiebreaker: \`{ orderBy: [{ method: "hitsTotal", sortDirection: "desc" }, { method: "hitsLargeSpanTotal", sortDirection: "desc" }] }\`
- Content owned by specific users, modified in a date range: \`{ filter: { ownerIds: [123, 456], modifiedTime: { startDate: "2026-01-01T00:00:00Z", endDate: "2026-06-30T23:59:59Z" } } }\`
`,
    paramsSchema,
    annotations: {
      title: 'Search Content',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ terms, limit, orderBy, filter }, extra): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      const orderByString = orderBy ? buildOrderByString(orderBy) : undefined;
      const filterString = filter ? buildFilterString(filter) : undefined;
      return await searchContentTool.logAndExecute<Array<ReducedSearchContentResponse>>({
        extra,
        args: {},
        callback: async () => {
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: searchContentTool.requiredApiScopes,
              callback: async (restApi) => {
                const maxResultLimit = configWithOverrides.getMaxResultLimit(
                  searchContentTool.name,
                );

                const response = await restApi.contentExplorationMethods.searchContent({
                  terms,
                  page: 0,
                  limit: maxResultLimit ? Math.min(maxResultLimit, limit ?? 100) : (limit ?? 100),
                  order_by: orderByString,
                  filter: filterString,
                });
                const searchResults = reduceSearchContentResponse(response);

                if (configWithOverrides.disableMetadataApiRequests) {
                  return searchResults;
                }

                return await enrichSearchResultsWithLineage({
                  searchResults,
                  datasourceIds: configWithOverrides.boundedContext.datasourceIds,
                  graphql: (query) => restApi.metadataMethods.graphql(query),
                });
              },
            }),
          );
        },
        constrainSuccessResult: (items) =>
          constrainSearchContent({ items, boundedContext: configWithOverrides.boundedContext }),
      });
    },
  });

  return searchContentTool;
};

async function enrichSearchResultsWithLineage({
  searchResults,
  datasourceIds,
  graphql,
}: {
  searchResults: Array<ReducedSearchContentResponse>;
  datasourceIds?: Set<string> | null;
  graphql: (query: string) => Promise<unknown>;
}): Promise<Array<ReducedSearchContentResponse>> {
  const workbookLuids = getSearchResultLuids(searchResults, 'workbook');
  const viewLuids = getSearchResultLuids(searchResults, 'view');

  const { workbookLineageByLuid, viewLineageByLuid } = await getSearchContentLineage({
    workbookLuids,
    viewLuids,
    graphql,
  });

  return searchResults.map((item) => {
    if (item.type === 'workbook' && typeof item.luid === 'string') {
      const upstreamDatasources = filterLineageContentsByAllowedIds(
        workbookLineageByLuid.get(item.luid),
        datasourceIds,
      );
      return upstreamDatasources.length ? { ...item, upstreamDatasources } : item;
    }

    if (item.type === 'view' && typeof item.luid === 'string') {
      const upstreamDatasources = filterLineageContentsByAllowedIds(
        viewLineageByLuid.get(item.luid)?.upstreamDatasources,
        datasourceIds,
      );
      return upstreamDatasources.length ? { ...item, upstreamDatasources } : item;
    }

    return item;
  });
}

async function getSearchContentLineage({
  workbookLuids,
  viewLuids,
  graphql,
}: {
  workbookLuids: Array<string>;
  viewLuids: Array<string>;
  graphql: (query: string) => Promise<unknown>;
}): Promise<{
  workbookLineageByLuid: ReturnType<typeof getWorkbookLineageByLuid>;
  viewLineageByLuid: ReturnType<typeof getViewLineageByLuid>;
}> {
  if (workbookLuids.length === 0 && viewLuids.length === 0) {
    return { workbookLineageByLuid: new Map(), viewLineageByLuid: new Map() };
  }

  try {
    const response = await graphql(getSearchContentLineageQuery({ workbookLuids, viewLuids }));
    return {
      workbookLineageByLuid: workbookLuids.length ? getWorkbookLineageByLuid(response) : new Map(),
      viewLineageByLuid: viewLuids.length ? getViewLineageByLuid(response) : new Map(),
    };
  } catch (error) {
    log({
      message: 'Failed to enrich search results with lineage metadata',
      level: 'warning',
      logger: 'lineage',
      data: getExceptionMessage(error),
    });
    return { workbookLineageByLuid: new Map(), viewLineageByLuid: new Map() };
  }
}

function getSearchResultLuids(
  searchResults: Array<ReducedSearchContentResponse>,
  type: 'view' | 'workbook',
): Array<string> {
  return searchResults.flatMap((item) =>
    item.type === type && typeof item.luid === 'string' ? [item.luid] : [],
  );
}
