import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

const personalSpaceSchema = z.object({
  // Tableau returns <personalSpace luid="..." ownerLuid="..."/>; JSON keys mirror the attributes.
  luid: z.string(),
  ownerLuid: z.string().optional(),
});

const getPersonalSpaceEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/personalSpace',
  alias: 'getPersonalSpace',
  description: "Returns the authenticated user's personal space, including its LUID.",
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
  ],
  response: z.object({ personalSpace: personalSpaceSchema }),
});

const publishingApi = makeApi([getPersonalSpaceEndpoint]);

export const publishingApis = [...publishingApi] as const satisfies ZodiosEndpointDefinitions;
