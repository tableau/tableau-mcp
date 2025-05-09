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
          name: z.string(),
          password: z.string(),
        })
        .or(
          z.object({
            personalAccessTokenName: z.string(),
            personalAccessTokenSecret: z.string(),
          }),
        )
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
  description: 'Signs in with a username and password.',
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
