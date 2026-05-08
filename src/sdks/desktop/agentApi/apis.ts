import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import {
  executeCommandRequestSchema,
  executeCommandResponseSchema,
  getCommandStatusResponseSchema,
  getEventsResponseSchema,
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

const getEventsEndpoint = makeEndpoint({
  method: 'get',
  path: '/events',
  alias: 'getEvents',
  description: 'Gets events from Tableau.',
  parameters: [
    {
      name: 'since',
      type: 'Query',
      schema: z.number().optional(),
    },
  ],
  response: getEventsResponseSchema,
});

const agentApi = makeApi([getCommandStatusEndpoint, executeCommandEndpoint, getEventsEndpoint]);
export const agentApis = [...agentApi] as const satisfies ZodiosEndpointDefinitions;
