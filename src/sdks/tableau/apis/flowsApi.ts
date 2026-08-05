import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import {
  flowConnectionSchema,
  flowOutputStepSchema,
  flowRunSchema,
  flowSchema,
} from '../types/flow.js';
import { paginationSchema } from '../types/pagination.js';
import { paginationParameters } from './paginationParameters.js';

const queryFlowsForSiteEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/flows',
  alias: 'queryFlowsForSite',
  description:
    'Returns the flows on a site. If the user is not an administrator, the method returns just the flows that the user has permissions to view.',
  parameters: [
    ...paginationParameters,
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'filter',
      type: 'Query',
      schema: z.string().optional(),
      description:
        'An expression that lets you specify a subset of flows to return. You can filter on predefined fields such as name, tags, and createdAt. You can include multiple filter expressions.',
    },
    {
      name: 'sort',
      type: 'Query',
      schema: z.string().optional(),
      description:
        'An expression that lets you specify the order in which flow information is returned (e.g. createdAt:desc).',
    },
  ],
  response: z.object({
    pagination: paginationSchema,
    flows: z.object({
      flow: z.optional(z.array(flowSchema)),
    }),
  }),
});

const queryFlowEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/flows/:flowId',
  alias: 'queryFlow',
  description:
    'Returns information about the specified flow, including information about the project, owner, and output steps.',
  response: z.object({
    flowOutputSteps: z
      .object({
        flowOutputStep: z.optional(z.array(flowOutputStepSchema)),
      })
      .optional(),
    flow: flowSchema,
  }),
});

const queryFlowConnectionsEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/flows/:flowId/connections',
  alias: 'queryFlowConnections',
  description: 'Returns a list of data connections for the specified flow.',
  response: z.object({
    connections: z.object({
      connection: z.optional(z.array(flowConnectionSchema)),
    }),
  }),
});

const getFlowRunsEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/flows/runs',
  alias: 'getFlowRuns',
  description:
    'Returns flow runs on a site. Supports filtering by predefined fields such as flowId, userId, progress, startedAt, and completedAt.',
  parameters: [
    ...paginationParameters,
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'filter',
      type: 'Query',
      schema: z.string().optional(),
      description:
        'An expression that lets you specify a subset of flow runs to return (e.g. flowId:eq:abc-123).',
    },
    {
      name: 'sort',
      type: 'Query',
      schema: z.string().optional(),
      description:
        'An expression that lets you specify the order in which flow run information is returned (e.g. startedAt:desc).',
    },
  ],
  response: z.object({
    flowRuns: z.object({
      flowRuns: z.optional(z.array(flowRunSchema)),
    }),
  }),
});

const flowsApi = makeApi([
  queryFlowsForSiteEndpoint,
  queryFlowEndpoint,
  queryFlowConnectionsEndpoint,
  getFlowRunsEndpoint,
]);

export const flowsApis = [...flowsApi] as const satisfies ZodiosEndpointDefinitions;
