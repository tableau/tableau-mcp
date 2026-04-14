import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

const jobsPlaceholderEndpoint = makeEndpoint({
  method: 'get',
  path: '/__jobs_sdk_placeholder',
  alias: 'jobsPlaceholder',
  description: 'Unused placeholder so Zodios can construct a client.',
  response: z.any(),
  parameters: [],
});

const jobsApi = makeApi([jobsPlaceholderEndpoint]);
export const jobsApis = [...jobsApi] as const satisfies ZodiosEndpointDefinitions;
