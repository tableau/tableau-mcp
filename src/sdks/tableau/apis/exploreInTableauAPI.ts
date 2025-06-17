import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

// Schema for the request payload
const exploreInTableauRequestSchema = z.object({
  tdsContent: z.string().describe('Base64 encoded TDS content'),
});

// Schema for the response - API returns redirect URL in headers, not body
const exploreInTableauResponseSchema = z.object({
  message: z.string().optional(),
  status: z.string().optional(),
}).optional(); // Response body might be empty

export type ExploreInTableauRequest = z.infer<typeof exploreInTableauRequestSchema>;
export type ExploreInTableauResponse = z.infer<typeof exploreInTableauResponseSchema>;

const exploreInTableauEndpoint = makeEndpoint({
  method: 'post',
  path: '/analytics/integration/explore-in-tableau/v1/upload-tds-content/demo',
  alias: 'exploreInTableau',
  description: 'Submit TDS content to explore in Tableau. Returns redirect URL in response headers (Location header).',
  parameters: [
    {
      name: 'body',
      type: 'Body',
      schema: exploreInTableauRequestSchema,
    },
  ],
  response: exploreInTableauResponseSchema,
  requestFormat: 'json',
});

const exploreInTableauApi = makeApi([exploreInTableauEndpoint]);
export const exploreInTableauApis = [...exploreInTableauApi] as const satisfies ZodiosEndpointDefinitions;