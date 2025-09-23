import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { serverInfo } from '../types/serverInfo.js';

const getServerInfoEndpoint = makeEndpoint({
  method: 'get',
  path: '/serverinfo',
  alias: 'getServerInfo',
  description: 'Returns the version of Tableau Server and the supported version of the REST API.',
  response: z.object({
    serverInfo,
  }),
});

const serverApi = makeApi([getServerInfoEndpoint]);
export const serverApis = [...serverApi] as const satisfies ZodiosEndpointDefinitions;
