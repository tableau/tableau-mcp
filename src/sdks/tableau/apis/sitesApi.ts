import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { siteSchema } from '../types/site.js';

const getSiteEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId',
  alias: 'getSite',
  description: 'Returns information about the specified site.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
  ],
  response: z.object({ site: siteSchema }),
});

const sitesApi = makeApi([getSiteEndpoint]);

export const sitesApis = [...sitesApi] as const satisfies ZodiosEndpointDefinitions;
