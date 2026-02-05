import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

export const startSessionEndpoint = makeEndpoint({
  method: 'post',
  path: '/vizql/t/:siteName/w/:workbookName/v/:viewName/startSession/viewing',
  alias: 'startSession',
  parameters: [
    {
      name: 'siteName',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'workbookName',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'viewName',
      type: 'Path',
      schema: z.string(),
    },
  ],
  response: z.object({
    sessionid: z.string(),
  }),
});

const vizqlApi = makeApi([startSessionEndpoint]);
export const vizqlApis = [...vizqlApi] as const satisfies ZodiosEndpointDefinitions;
