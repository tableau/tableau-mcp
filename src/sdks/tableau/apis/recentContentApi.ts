import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';

import { pathParam } from '../../routeSafety/ids.js';
import { recentContentResponseSchema } from '../types/recentContent.js';

const getRecentlyViewedForSiteEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/content/recent',
  alias: 'getRecentlyViewedForSite',
  description: "Gets the signed-in user's latest 24 views and workbooks on the site.",
  parameters: [pathParam('siteId', 'segment')],
  response: recentContentResponseSchema,
});

const recentContentApi = makeApi([getRecentlyViewedForSiteEndpoint]);

export const recentContentApis = [...recentContentApi] as const satisfies ZodiosEndpointDefinitions;
