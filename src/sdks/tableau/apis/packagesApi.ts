import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';

import { allowedOriginsSchema } from '../types/packages.js';

// Experimental endpoint. It lives under `/api/exp` (NOT the versioned `/api/3.x`
// path), so it is exposed through its own methods class whose base URL is
// `${host}/api/exp` (see RestApi.packagesMethods).
const getAllowedOriginsEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/packages/allowed-origins',
  alias: 'getAllowedOrigins',
  description:
    "Returns the site's external allowed-origins allow-list for extension packages. Experimental API (api/exp); requires the tableau:packages:read scope and the Packages feature flag.",
  response: allowedOriginsSchema,
});

const packagesApi = makeApi([getAllowedOriginsEndpoint]);

export const packagesApis = [...packagesApi] as const satisfies ZodiosEndpointDefinitions;
