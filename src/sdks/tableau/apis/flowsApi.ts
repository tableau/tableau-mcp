import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { flowSchema } from '../types/flow.js';
import { paginationSchema } from '../types/pagination.js';

const listFlowsRestEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/flows',
  alias: 'listFlows',
  description:
    'Returns a list of flows on the specified site. Supports filter, sort, page-size, and page-number as query parameters.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'filter',
      type: 'Query',
      schema: z.string().optional(),
      description: 'Filter expression (e.g., name:eq:SalesFlow)',
    },
    {
      name: 'sort',
      type: 'Query',
      schema: z.string().optional(),
      description: 'Sort expression (e.g., createdAt:desc)',
    },
    {
      name: 'page-size',
      type: 'Query',
      schema: z.number().optional(),
      description:
        'The number of items to return in one response. The minimum is 1. The maximum is 1000. The default is 100.',
    },
    {
      name: 'page-number',
      type: 'Query',
      schema: z.number().optional(),
      description: 'The offset for paging. The default is 1.',
    },
  ],
  response: z.object({
    pagination: paginationSchema,
    flows: z.object({
      flow: z.optional(z.array(flowSchema)),
    }),
  }),
});

const flowsApi = makeApi([listFlowsRestEndpoint]);
export const flowsApis = [...flowsApi] as const satisfies ZodiosEndpointDefinitions;
