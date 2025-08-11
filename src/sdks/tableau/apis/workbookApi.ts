import { makeApi, makeEndpoint, ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';
import { z } from 'zod';

import { paginationSchema } from '../types/pagination.js';
import { workbookSchema } from '../types/workbook.js';

const getWorkbookEndpoint = makeEndpoint({
  method: 'get',
  path: `/sites/:siteId/workbooks/:workbookId`,
  alias: 'getWorkbook',
  description:
    'Returns information about the specified workbook, including information about views and tags.',
  response: z.object({ workbook: workbookSchema }),
});

const queryViewDataEndpoint = makeEndpoint({
  method: 'get',
  path: `/sites/:siteId/views/:viewId/data`,
  alias: 'queryViewData',
  description: 'Returns a specified view rendered as data in comma separated value (CSV) format.',
  response: z.string(),
});

const queryViewImageEndpoint = makeEndpoint({
  method: 'get',
  path: `/sites/:siteId/views/:viewId/image?resolution=high`,
  alias: 'queryViewImage',
  description: 'Returns an image of the specified view.',
  response: z.string(),
});

const queryWorkbooksForSiteEndpoint = makeEndpoint({
  method: 'get',
  path: `/sites/:siteId/workbooks`,
  alias: 'queryWorkbooksForSite',
  description: 'Returns the workbooks on a site.',
  parameters: [
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
    {
      name: 'pageSize',
      type: 'Query',
      schema: z.number().optional(),
      description:
        'The number of items to return in one response. The minimum is 1. The maximum is 1000. The default is 100.',
    },
    {
      name: 'pageNumber',
      type: 'Query',
      schema: z.number().optional(),
      description: 'The offset for paging. The default is 1.',
    },
  ],
  response: z.object({
    pagination: paginationSchema,
    workbooks: z.object({
      workbook: z.optional(z.array(workbookSchema)),
    }),
  }),
});

const workbookApi = makeApi([
  queryViewDataEndpoint,
  queryViewImageEndpoint,
  queryWorkbooksForSiteEndpoint,
  getWorkbookEndpoint,
]);

export const workbookApis = [...workbookApi] as const satisfies ZodiosEndpointDefinitions;
export type WorkbookApiClient = ZodiosInstance<typeof workbookApis>;
