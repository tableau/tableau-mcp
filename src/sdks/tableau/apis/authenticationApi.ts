import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { credentialsSchema } from '../types/credentials.js';

const signInRequestSchema = z.object({
  credentials: z
    .object({
      site: z.object({
        contentUrl: z.string(),
      }),
    })
    .and(
      z
        .object({
          personalAccessTokenName: z.string(),
          personalAccessTokenSecret: z.string(),
        })
        .or(
          z.object({
            jwt: z.string(),
          }),
        ),
    ),
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

const signOutEndpoint = makeEndpoint({
  method: 'post',
  path: '/auth/signout',
  alias: 'signOut',
  description:
    'Signs you out of the current session. This call invalidates the authentication token that is created by a call to Sign In.',
  response: z.void(),
});

const authenticationApi = makeApi([signInEndpoint, signOutEndpoint]);
export const authenticationApis = [
  ...authenticationApi,
] as const satisfies ZodiosEndpointDefinitions;
