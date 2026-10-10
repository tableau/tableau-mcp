import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { dataSourceSchema, publishedDataSourceSchema } from '../types/dataSource.js';
import { paginationSchema } from '../types/pagination.js';
import { datasourcePermissionsSchema } from '../types/permissions.js';
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
      datasource: z.optional(z.array(publishedDataSourceSchema)),
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
  // Declared so isErrorFromAlias can narrow the caught error; a 404 (no such published data source)
  // is used by tryQueryDatasource to classify a LUID as embedded.
  errors: [
    {
      status: 'default',
      schema: z.any(),
    },
    {
      status: 404,
      schema: z.any(),
    },
  ],
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

/**
 * Query Data Source Permissions
 * GET /api/api-version/sites/site-id/datasources/datasource-id/permissions
 * @see https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_permissions.htm#query_data_source_permissions
 */
const queryDatasourcePermissionsEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/datasources/:datasourceId/permissions',
  alias: 'queryDatasourcePermissions',
  description: 'Returns the permissions (grantee capabilities) for the specified data source.',
  response: datasourcePermissionsSchema,
});

const datasourcesApi = makeApi([
  listDatasourcesEndpoint,
  queryDatasourceEndpoint,
  deleteDatasourceEndpoint,
  addTagsToDatasourceEndpoint,
  queryDatasourcePermissionsEndpoint,
]);
export const datasourcesApis = [...datasourcesApi] as const satisfies ZodiosEndpointDefinitions;
