import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { personalSpaceSchema } from '../types/personalSpace.js';

const getPersonalSpaceEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/personalSpace',
  alias: 'getPersonalSpace',
  description: "Returns the calling user's Personal Space on the specified site.",
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
  ],
  response: z.object({ personalSpace: personalSpaceSchema }),
});

const personalSpaceApi = makeApi([getPersonalSpaceEndpoint]);

export const personalSpaceApis = [...personalSpaceApi] as const satisfies ZodiosEndpointDefinitions;
