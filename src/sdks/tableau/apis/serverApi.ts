import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { siteSchema } from '../types/site.js';
import { userSchema } from '../types/user.js';

const sessionSchema = z.object({
  site: siteSchema,
  user: userSchema,
});

const getCurrentServerSessionEndpoint = makeEndpoint({
  method: 'get',
  path: '/sessions/current',
  alias: 'getCurrentServerSession',
  description: 'Returns details of the current session of Tableau Server.',
  response: z.object({ session: sessionSchema }),
});

export type Session = z.infer<typeof sessionSchema>;
const serverApi = makeApi([getCurrentServerSessionEndpoint]);
export const serverApis = [...serverApi] as const satisfies ZodiosEndpointDefinitions;
