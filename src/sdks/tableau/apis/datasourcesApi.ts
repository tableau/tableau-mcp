import { makeApi, makeEndpoint, ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';
import { AxiosError } from 'axios';
import { z } from 'zod';

import { multipartRequestSchema } from '../plugins/postMultipartPlugin.js';
import { restApiErrorSchema } from '../types/restApiError.js';

const projectSchema = z.object({
  name: z.string(),
  id: z.string(),
});

const dataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  project: projectSchema,
});

export type Datasource = z.infer<typeof dataSourceSchema>;
const listDatasourcesRestEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/datasources',
  alias: 'listDatasources',
  description:
    'Returns a list of published data sources on the specified site. Supports a filter string as a query parameter in the format field:operator:value.',
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
      description: 'Filter string in the format field:operator:value (e.g., name:eq:Project Views)',
    },
  ],
  response: z.object({
    datasources: z.object({
      datasource: z.optional(z.array(dataSourceSchema)),
    }),
  }),
});

const publishDataSourceEndpoint = makeEndpoint({
  method: 'post',
  path: `/sites/:siteId/datasources`,
  alias: 'publishWorkbook',
  description: 'Publishes a workbook on the specified site.',
  response: z.object({ datasource: dataSourceSchema }),
  parameters: [
    {
      name: 'body',
      type: 'Body',
      schema: multipartRequestSchema,
    },
  ],
});

export function throwIfPublishFailed(e: unknown, dataSourceName: string): void {
  if (e instanceof AxiosError && e.status === 403) {
    const { success, data } = restApiErrorSchema.safeParse(e.response?.data);

    if (
      success &&
      data.error.code === '403007' &&
      data.error.detail.includes(
        `The datasource '${dataSourceName}' already exists and may not be overwritten without the 'overwrite' flag set to 'true'.`,
      )
    ) {
      console.debug(`The datasource '${dataSourceName}' already exists.`);
      return;
    }
  }

  throw e;
}

const datasourcesApi = makeApi([listDatasourcesRestEndpoint, publishDataSourceEndpoint]);
export const datasourcesApis = [...datasourcesApi] as const satisfies ZodiosEndpointDefinitions;
export type DataSourcesApiClient = ZodiosInstance<typeof datasourcesApi>;
