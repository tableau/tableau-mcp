import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { searchContentResponseSchema } from '../types/contentExploration.js';

const searchContentEndpoint = makeEndpoint({
  method: 'get',
  path: '/search',
  alias: 'searchContent',
  description:
    'Searches across all supported content types for objects relevant to the search expression specified in the querystring of the request URI.',
  parameters: [
    {
      name: 'terms',
      type: 'Query',
      schema: z.string().optional(),
    },
    {
      name: 'page',
      type: 'Query',
      schema: z.number().int().optional(),
    },
    {
      name: 'limit',
      type: 'Query',
      schema: z.number().int().optional(),
    },
    {
      name: 'order_by',
      type: 'Query',
      schema: z.string().optional(),
    },
    {
      name: 'filter',
      type: 'Query',
      schema: z.string().optional(),
    },
  ],
  response: z.object({
    hits: searchContentResponseSchema,
  }),
});

const contentExplorationApi = makeApi([searchContentEndpoint]);

export const contentExplorationApis = [
  ...contentExplorationApi,
] as const satisfies ZodiosEndpointDefinitions;
