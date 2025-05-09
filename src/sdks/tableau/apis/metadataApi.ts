import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

const graphqlResponse = z.object({
  data: z.object({
    publishedDatasources: z.array(
      z.object({
        name: z.string(),
        description: z.string().or(z.null()),
        datasourceFilters: z.array(
          z.object({
            field: z.object({
              name: z.string(),
              description: z.string().or(z.null()),
            }),
          }),
        ),
        fields: z.array(
          z.object({
            name: z.string(),
            description: z.string().or(z.null()),
          }),
        ),
      }),
    ),
  }),
});

export type GraphQLResponse = z.infer<typeof graphqlResponse>;

const graphqlEndpoint = makeEndpoint({
  method: 'post',
  path: '/graphql',
  alias: 'graphql',
  response: graphqlResponse,
  parameters: [
    {
      name: 'query',
      type: 'Body',
      schema: z.object({
        query: z.string(),
      }),
    },
  ],
});

const metadataApi = makeApi([graphqlEndpoint]);
export const metadataApis = [...metadataApi] as const satisfies ZodiosEndpointDefinitions;
