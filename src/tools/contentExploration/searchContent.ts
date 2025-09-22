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
    description: 'Search for content in the Tableau Server', // TODO: Add description
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
