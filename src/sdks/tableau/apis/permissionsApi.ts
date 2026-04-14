import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

/**
 * Zodios requires at least one endpoint; permissions use raw axios paths in PermissionsMethods.
 */
const permissionsPlaceholderEndpoint = makeEndpoint({
  method: 'get',
  path: '/__permissions_sdk_placeholder',
  alias: 'permissionsPlaceholder',
  description: 'Unused placeholder so Zodios can construct a client.',
  response: z.any(),
  parameters: [],
});

const permissionsApi = makeApi([permissionsPlaceholderEndpoint]);
export const permissionsApis = [...permissionsApi] as const satisfies ZodiosEndpointDefinitions;
