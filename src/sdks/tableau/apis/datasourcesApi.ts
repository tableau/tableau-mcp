import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { dataSourceSchema } from '../types/dataSource.js';
import { paginationSchema } from '../types/pagination.js';
import { tagsSchema } from '../types/tags.js';
import { paginationParameters } from './paginationParameters.js';

const listDatasourcesEndpoint = makeEndpoint({
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

const queryDatasourceEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/datasources/:datasourceId',
  alias: 'queryDatasource',
  description: 'Returns information about the specified data source.',
  response: z.object({
    datasource: dataSourceSchema,
  }),
});

const deleteDatasourceEndpoint = makeEndpoint({
  method: 'delete',
  path: '/sites/:siteId/datasources/:datasourceId',
  alias: 'deleteDatasource',
  description:
    'Deletes the specified published data source from the site. On Tableau Cloud the data source is moved to the recycle bin and can be restored for a limited time.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'datasourceId',
      type: 'Path',
      schema: z.string(),
    },
  ],
  response: z.void(),
});

const addTagsToDatasourceEndpoint = makeEndpoint({
  method: 'put',
  path: '/sites/:siteId/datasources/:datasourceId/tags',
  alias: 'addTagsToDatasource',
  description: 'Adds one or more tags to the specified data source.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'datasourceId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'body',
      type: 'Body',
      schema: z.object({ tags: tagsSchema }),
    },
  ],
  response: z.object({ tags: tagsSchema }),
});

const datasourcesApi = makeApi([
  listDatasourcesEndpoint,
  queryDatasourceEndpoint,
  deleteDatasourceEndpoint,
  addTagsToDatasourceEndpoint,
]);
export const datasourcesApis = [...datasourcesApi] as const satisfies ZodiosEndpointDefinitions;
