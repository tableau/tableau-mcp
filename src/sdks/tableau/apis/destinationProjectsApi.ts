import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { paginationSchema } from '../types/pagination.js';
import { destinationProjectContentTypeSchema, destinationProjectSchema } from '../types/project.js';
import { paginationParameters } from './paginationParameters.js';

// Experimental endpoint. It lives under `/api/exp` (NOT the versioned `/api/3.x` path Query
// Projects uses), so it is exposed through its own methods class whose base URL is
// `${host}/api/exp` (see RestApi.destinationProjectsMethods).
const queryDestinationProjectsEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/projects/destinations',
  alias: 'queryDestinationProjects',
  description:
    'Returns the projects the user can see as candidate destinations for publishing or moving the given content type, each with an eligibility status. Experimental API (api/exp) gated by the GetDestinationProjectsAPI site feature flag; requires the tableau:projects:read scope.',
  parameters: [
    ...paginationParameters,
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'contentType',
      type: 'Query',
      schema: destinationProjectContentTypeSchema,
    },
    {
      name: 'sourceIds',
      type: 'Query',
      // Comma-separated LUIDs: Spring binds a comma-delimited value to List<String>, whereas axios
      // would serialize an array as `sourceIds[]=...`, which the server does not accept.
      schema: z.string().optional(),
    },
    {
      name: 'filter',
      type: 'Query',
      schema: z.string().optional(),
    },
  ],
  response: z.object({
    pagination: paginationSchema,
    destinationProjects: z.object({
      destinationProject: z.optional(z.array(destinationProjectSchema)),
    }),
  }),
});

const destinationProjectsApi = makeApi([queryDestinationProjectsEndpoint]);

export const destinationProjectsApis = [
  ...destinationProjectsApi,
] as const satisfies ZodiosEndpointDefinitions;
