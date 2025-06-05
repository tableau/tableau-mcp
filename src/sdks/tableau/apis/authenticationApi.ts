import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { credentialsSchema } from '../types/credentials.js';

const signInRequestSchema = z.object({
  credentials: z.object({
    site: z.object({
      contentUrl: z.string(),
    }),
    personalAccessTokenName: z.string(),
    personalAccessTokenSecret: z.string(),
  }),
});

const signInEndpoint = makeEndpoint({
  method: 'post',
  path: '/auth/signin',
  alias: 'signIn',
  description: 'Signs in with Tableau credentials.',
  response: credentialsSchema,
  parameters: [
    {
      name: 'credentials',
      type: 'Body',
      schema: signInRequestSchema,
    },
  ],
});

const authenticationApi = makeApi([signInEndpoint]);
export const authenticationApis = [
  ...authenticationApi,
] as const satisfies ZodiosEndpointDefinitions;
