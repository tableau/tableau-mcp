import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { dataSourceSchema } from '../types/dataSource.js';
import { paginationSchema } from '../types/pagination.js';
import { paginationParameters } from './paginationParameters.js';

const listDatasourcesRestEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/datasources',
  alias: 'listDatasources',
  description:
    'Returns a list of published data sources on the specified site. Supports a filter string as a query parameter in the format field:operator:value.',
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
      description: 'Filter string in the format field:operator:value (e.g., name:eq:Project Views)',
    },
  ],
  response: z.object({
    pagination: paginationSchema,
    datasources: z.object({
      datasource: z.optional(z.array(dataSourceSchema)),
    }),
  }),
});

const datasourcesApi = makeApi([listDatasourcesRestEndpoint]);
export const datasourcesApis = [...datasourcesApi] as const satisfies ZodiosEndpointDefinitions;
