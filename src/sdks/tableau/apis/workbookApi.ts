import { makeApi, makeEndpoint, ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';
import { z } from 'zod';

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
  response: z.object({
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
