import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { luidSchema, pathParam } from '../../routeSafety/ids.js';

// Retain only the identity proof. Grants, names and unrelated metadata are stripped.
export const collectionOwnerPermissionsSchema = z.object({
  permissions: z.object({
    collection: z.object({ id: luidSchema, owner: z.object({ id: luidSchema }) }),
  }),
});

const endpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/collections/:collectionId/permissions',
  alias: 'queryCollectionOwner',
  parameters: [pathParam('siteId'), pathParam('collectionId')],
  response: collectionOwnerPermissionsSchema,
});

const collectionPermissionsApi = makeApi([endpoint]);
export const collectionPermissionsApis = [
  ...collectionPermissionsApi,
] as const satisfies ZodiosEndpointDefinitions;
