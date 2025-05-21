import {
    makeApi,
    makeEndpoint,
    ZodiosEndpointDefinitions,
  } from '@zodios/core';
import { z } from 'zod';

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
  description: 'Returns a list of published data sources on the specified site. Supports a filter string as a query parameter in the format field:operator:value.',
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

const datasourcesApi = makeApi([listDatasourcesRestEndpoint]);
export const datasourcesApis = [...datasourcesApi] as const satisfies ZodiosEndpointDefinitions;