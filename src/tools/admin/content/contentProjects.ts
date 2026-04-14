import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { JwtScopes, useRestApi } from '../../../restApiInstance.js';
import { Server } from '../../server.js';
import { Tool } from '../../tool.js';

const operations = [
  'query-projects',
  'create-project',
  'update-project',
  'delete-project',
] as const;

type ContentProjectsOperation = (typeof operations)[number];

const jwtScopesByOperation: Record<ContentProjectsOperation, JwtScopes[]> = {
  'query-projects': ['tableau:content:read'],
  'create-project': ['tableau:content:update'],
  'update-project': ['tableau:content:update'],
  'delete-project': ['tableau:content:delete'],
};

const paramsSchema = {
  operation: z.enum(operations),
  projectId: z.string().optional(),
  filter: z.string().optional(),
  sort: z.string().optional(),
  pageSize: z.number().gt(0).optional(),
  pageNumber: z.number().gt(0).optional(),
  fields: z.string().optional(),
  body: z.unknown().optional(),
};

const filteringDoc =
  'https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm';

export const getContentProjectsTool = (server: Server): Tool<typeof paramsSchema> => {
  const tool = new Tool({
    server,
    name: 'content-projects',
    description: `Tableau site projects: list with optional filter/sort/paging, create, update, or delete. Pass filter/sort using Tableau REST syntax (see ${filteringDoc}). Examples: updatedAt:gte:2024-01-01T00:00:00Z, name:eq:Sales.`,
    paramsSchema,
    annotations: {
      title: 'Content — Projects',
      readOnlyHint: false,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: jwtScopesByOperation[args.operation],
              callback: async (restApi) =>
                await invokeOperation(restApi.projectsMethods, restApi.siteId, args),
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return tool;
};

async function invokeOperation(
  projectsMethods: {
    queryProjects: (p: {
      siteId: string;
      filter?: string;
      sort?: string;
      pageSize?: number;
      pageNumber?: number;
      fields?: string;
    }) => Promise<unknown>;
    createProject: (p: { siteId: string; body: unknown }) => Promise<unknown>;
    updateProject: (p: { siteId: string; projectId: string; body: unknown }) => Promise<unknown>;
    deleteProject: (p: { siteId: string; projectId: string }) => Promise<unknown>;
  },
  siteId: string,
  args: z.objectOutputType<typeof paramsSchema, z.ZodTypeAny>,
): Promise<unknown> {
  switch (args.operation) {
    case 'query-projects':
      return await projectsMethods.queryProjects({
        siteId,
        filter: args.filter,
        sort: args.sort,
        pageSize: args.pageSize,
        pageNumber: args.pageNumber,
        fields: args.fields,
      });
    case 'create-project':
      return await projectsMethods.createProject({
        siteId,
        body: required(args.body, 'body'),
      });
    case 'update-project':
      return await projectsMethods.updateProject({
        siteId,
        projectId: required(args.projectId, 'projectId'),
        body: required(args.body, 'body'),
      });
    case 'delete-project':
      return await projectsMethods.deleteProject({
        siteId,
        projectId: required(args.projectId, 'projectId'),
      });
  }
}

function required<T>(value: T | undefined, fieldName: string): T {
  if (value === undefined || value === null) {
    throw new Error(`Missing required parameter: ${fieldName}`);
  }
  return value;
}
