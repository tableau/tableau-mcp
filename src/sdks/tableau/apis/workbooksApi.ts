import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { connectionSchema } from '../types/connection.js';
import { paginationSchema } from '../types/pagination.js';
import { workbookSchema } from '../types/workbook.js';
import { paginationParameters } from './paginationParameters.js';

const getWorkbookEndpoint = makeEndpoint({
  method: 'get',
  path: `/sites/:siteId/workbooks/:workbookId`,
  alias: 'getWorkbook',
  description:
    'Returns information about the specified workbook, including information about views and tags.',
  response: z.object({ workbook: workbookSchema }),
});

const queryWorkbooksForSiteEndpoint = makeEndpoint({
  method: 'get',
  path: `/sites/:siteId/workbooks`,
  alias: 'queryWorkbooksForSite',
  description: 'Returns the workbooks on a site.',
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
        'An expression that lets you specify a subset of workbooks to return. You can filter on predefined fields such as name, tags, and createdAt. You can include multiple filter expressions.',
    },
  ],
  response: z.object({
    pagination: paginationSchema,
    workbooks: z.object({
      workbook: z.optional(z.array(workbookSchema)),
    }),
  }),
});

const queryWorkbookConnectionsEndpoint = makeEndpoint({
  method: 'get',
  path: `/sites/:siteId/workbooks/:workbookId/connections`,
  alias: 'queryWorkbookConnections',
  description: 'Returns a list of data connections for the specific workbook.',
  response: z.object({ connections: z.object({ connection: z.array(connectionSchema) }) }),
});

const workbooksApi = makeApi([
  queryWorkbooksForSiteEndpoint,
  getWorkbookEndpoint,
  queryWorkbookConnectionsEndpoint,
]);

export const workbooksApis = [...workbooksApi] as const satisfies ZodiosEndpointDefinitions;
