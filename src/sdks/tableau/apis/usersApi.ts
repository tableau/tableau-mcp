import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { userSchema } from '../types/user.js';

const getUserEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/users/:userId',
  alias: 'getUser',
  description: 'Returns information about the specified user, including site role.',
  response: z.object({
    user: userSchema,
  }),
});

const usersApi = makeApi([getUserEndpoint]);

export const usersApis = [...usersApi] as const satisfies ZodiosEndpointDefinitions;
