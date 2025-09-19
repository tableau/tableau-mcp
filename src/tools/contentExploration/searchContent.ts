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
import { buildFilterString, buildOrderByString } from './searchContentUtils.js';

const paramsSchema = {
  terms: z.string().optional(),
  limit: z.number().int().max(2000).min(1).default(100).optional(),
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
      // TODO: Throw is orderByString includes "downstreamWorkbookCount" and filterString type is not eq:table or eq:database

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
                return await restApi.contentExplorationMethods.searchContent({
                  terms, // TODO: Check on restrictions for terms
                  page: 0,
                  limit: limit ?? 100,
                  orderBy: orderByString,
                  filter: filterString,
                });
              },
            }),
          );
        },
      });
    },
  });

  return searchContentTool;
};
