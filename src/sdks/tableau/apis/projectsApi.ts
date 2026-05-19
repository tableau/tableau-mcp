import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { paginationSchema } from '../types/pagination.js';
import { projectSchema } from '../types/project.js';
import { paginationParameters } from './paginationParameters.js';

const queryProjectsEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/projects',
  alias: 'queryProjects',
  description: 'Returns a list of projects on the specified site.',
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
        'An expression that lets you specify a subset of projects to return. You can filter on predefined fields such as name, ownerName, parentProjectId, and updatedAt. You can include multiple filter expressions.',
    },
  ],
  response: z.object({
    pagination: paginationSchema,
    projects: z.object({
      project: z.optional(z.array(projectSchema)),
    }),
  }),
});

const projectsApi = makeApi([queryProjectsEndpoint]);

export const projectsApis = [...projectsApi] as const satisfies ZodiosEndpointDefinitions;
