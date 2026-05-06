import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';

import {
  executeCommandRequestSchema,
  executeCommandResponseSchema,
  getCommandStatusResponseSchema,
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

const agentApi = makeApi([getCommandStatusEndpoint, executeCommandEndpoint]);
export const agentApis = [...agentApi] as const satisfies ZodiosEndpointDefinitions;
