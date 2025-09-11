import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { serverInfoSchema } from '../types/serverInfo.js';
import { sessionSchema } from '../types/session.js';

const getCurrentServerSessionEndpoint = makeEndpoint({
  method: 'get',
  path: '/sessions/current',
  alias: 'getCurrentServerSession',
  description: 'Returns details of the current session of Tableau Server.',
  response: z.object({ session: sessionSchema }),
  errors: [
    {
      status: 401,
      schema: z.object({
        error: z.object({
          code: z.string(),
          summary: z.string(),
          detail: z.string(),
        }),
      }),
    },
  ],
});

const getServerInfoEndpoint = makeEndpoint({
  method: 'get',
  path: '/serverinfo',
  alias: 'getServerInfo',
  description: 'Returns the version of Tableau Server and the supported version of the REST API.',
  response: z.object({ serverInfo: serverInfoSchema }),
});

export type Session = z.infer<typeof sessionSchema>;
const serverApi = makeApi([getCurrentServerSessionEndpoint, getServerInfoEndpoint]);
export const serverApis = [...serverApi] as const satisfies ZodiosEndpointDefinitions;
