import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';

import {
  executeCommandRequestSchema,
  executeCommandResponseSchema,
  getCommandStatusResponseSchema,
  healthResponseSchema,
} from './types';

const getCommandStatusEndpoint = makeEndpoint({
  method: 'get',
  path: '/commands/:commandId',
  alias: 'getCommandStatus',
  description: 'Gets the status of a command.',
  response: getCommandStatusResponseSchema,
});

const executeCommandEndpoint = makeEndpoint({
  method: 'post',
  path: '/commands',
  alias: 'executeCommand',
  description: 'Executes a command.',
  parameters: [
    {
      name: 'body',
      type: 'Body',
      schema: executeCommandRequestSchema,
    },
  ],
  response: executeCommandResponseSchema,
});

const healthEndpoint = makeEndpoint({
  method: 'get',
  path: '/health',
  alias: 'health',
  description: 'Checks the health of the agent.',
  response: healthResponseSchema,
});

const agentApi = makeApi([getCommandStatusEndpoint, executeCommandEndpoint, healthEndpoint]);
export const agentApis = [...agentApi] as const satisfies ZodiosEndpointDefinitions;
