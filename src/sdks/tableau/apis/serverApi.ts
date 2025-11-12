import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { serverInfo } from '../types/serverInfo.js';
import { siteSchema } from '../types/site.js';
import { userSchema } from '../types/user.js';

const sessionSchema = z.object({
  site: siteSchema,
  user: userSchema,
});

const getServerInfoEndpoint = makeEndpoint({
  method: 'get',
  path: '/serverinfo',
  alias: 'getServerInfo',
  description: 'Returns the version of Tableau Server and the supported version of the REST API.',
  response: z.object({
    serverInfo,
  }),
});

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

export type Session = z.infer<typeof sessionSchema>;
const serverApi = makeApi([getServerInfoEndpoint, getCurrentServerSessionEndpoint]);
export const serverApis = [...serverApi] as const satisfies ZodiosEndpointDefinitions;
