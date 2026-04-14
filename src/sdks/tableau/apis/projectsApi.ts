import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { paginationSchema } from '../types/pagination.js';
import { projectSchema } from '../types/project.js';
import { paginationParameters } from './paginationParameters.js';

const anyResponse = z.any();

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
        'An expression that lets you specify a subset of projects to return. You can filter on predefined fields such as name, createdAt, and updatedAt.',
    },
    {
      name: 'sort',
      type: 'Query',
      schema: z.string().optional(),
      description: 'Sort expression for the result set.',
    },
    {
      name: 'fields',
      type: 'Query',
      schema: z.string().optional(),
      description: 'Comma-separated list of fields to include in the response.',
    },
  ],
  response: z.object({
    pagination: paginationSchema,
    projects: z.object({
      project: z.array(projectSchema).optional(),
    }),
  }),
});

const createProjectEndpoint = makeEndpoint({
  method: 'post',
  path: '/sites/:siteId/projects',
  alias: 'createProject',
  description: 'Creates a project on the specified site.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    { name: 'body', type: 'Body', schema: z.any() },
  ],
  response: anyResponse,
});

const updateProjectEndpoint = makeEndpoint({
  method: 'put',
  path: '/sites/:siteId/projects/:projectId',
  alias: 'updateProject',
  description: 'Updates the specified project.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'projectId',
      type: 'Path',
      schema: z.string(),
    },
    { name: 'body', type: 'Body', schema: z.any() },
  ],
  response: anyResponse,
});

const deleteProjectEndpoint = makeEndpoint({
  method: 'delete',
  path: '/sites/:siteId/projects/:projectId',
  alias: 'deleteProject',
  description: 'Deletes the specified project.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'projectId',
      type: 'Path',
      schema: z.string(),
    },
  ],
  response: anyResponse,
});

const projectsApi = makeApi([
  queryProjectsEndpoint,
  createProjectEndpoint,
  updateProjectEndpoint,
  deleteProjectEndpoint,
]);

export const projectsApis = [...projectsApi] as const satisfies ZodiosEndpointDefinitions;
