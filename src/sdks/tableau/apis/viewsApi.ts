import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { viewSchema } from '../types/view.js';

const queryViewDataEndpoint = makeEndpoint({
  method: 'get',
  path: `/sites/:siteId/views/:viewId/data`,
  alias: 'queryViewData',
  description: 'Returns a specified view rendered as data in comma separated value (CSV) format.',
  response: z.string(),
});

const queryViewImageEndpoint = makeEndpoint({
  method: 'get',
  path: `/sites/:siteId/views/:viewId/image`,
  alias: 'queryViewImage',
  description: 'Returns an image of the specified view.',
  parameters: [
    {
      name: 'vizWidth',
      type: 'Query',
      schema: z.number().optional(),
      description:
        'The width of the rendered image in pixels that, along with the value of vizHeight determine its resolution and aspect ratio.',
    },
    {
      name: 'vizHeight',
      type: 'Query',
      schema: z.number().optional(),
      description:
        'The height of the rendered image in pixels that, along with the value of vizWidth determine its resolution and aspect ratio.',
    },
    {
      name: 'resolution',
      type: 'Query',
      schema: z.literal('high').optional(),
      description:
        'The resolution of the image. Image width and actual pixel density are determined by the display context of the image. Aspect ratio is always preserved. Set the value to high to ensure maximum pixel density.',
    },
  ],
  response: z.string(),
});

const queryViewsForWorkbookEndpoint = makeEndpoint({
  method: 'get',
  path: `/sites/:siteId/workbooks/:workbookId/views`,
  alias: 'queryViewsForWorkbook',
  description:
    'Returns all the views for the specified workbook, optionally including usage statistics.',
  parameters: [
    {
      name: 'includeUsageStatistics',
      type: 'Query',
      schema: z.boolean().optional(),
      description: 'true to return usage statistics. The default is false.',
    },
  ],
  response: z.object({ views: z.object({ view: z.array(viewSchema) }) }),
});

const viewsApi = makeApi([
  queryViewDataEndpoint,
  queryViewImageEndpoint,
  queryViewsForWorkbookEndpoint,
]);

export const viewsApis = [...viewsApi] as const satisfies ZodiosEndpointDefinitions;
