import { makeApi, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

const Connection = z.object({
  connectionLuid: z.string().optional(),
  connectionUsername: z.string(),
  connectionPassword: z.string(),
});

const Datasource = z.object({
  datasourceLuid: z.string(),
  connections: z.array(Connection).optional(),
});

const ReturnFormat = z.enum(['OBJECTS', 'ARRAYS']);

const QueryOptions = z
  .object({
    returnFormat: ReturnFormat,
    debug: z.boolean().default(false),
  })
  .partial()
  .passthrough();

export const ReadMetadataRequest = z
  .object({
    datasource: Datasource,
    options: QueryOptions.optional(),
  })
  .passthrough();

const Function = z.enum([
  'SUM',
  'AVG',
  'MEDIAN',
  'COUNT',
  'COUNTD',
  'MIN',
  'MAX',
  'STDEV',
  'VAR',
  'COLLECT',
  'YEAR',
  'QUARTER',
  'MONTH',
  'WEEK',
  'DAY',
  'TRUNC_YEAR',
  'TRUNC_QUARTER',
  'TRUNC_MONTH',
  'TRUNC_WEEK',
  'TRUNC_DAY',
  'AGG',
  'NONE',
  'UNSPECIFIED',
]);

const FieldMetadata = z
  .object({
    fieldName: z.string(),
    fieldCaption: z.string(),
    dataType: z.enum([
      'INTEGER',
      'REAL',
      'STRING',
      'DATETIME',
      'BOOLEAN',
      'DATE',
      'SPATIAL',
      'UNKNOWN',
    ]),
    defaultAggregation: Function,
    logicalTableId: z.string(),
  })
  .partial()
  .passthrough();

export const MetadataOutput = z
  .object({
    data: z.array(FieldMetadata),
  })
  .partial()
  .passthrough();

export const TableauError = z
  .object({
    errorCode: z.string(),
    message: z.string(),
    datetime: z.string().datetime({ offset: true }),
    debug: z.object({}).partial().passthrough(),
    'tab-error-code': z.string(),
  })
  .partial()
  .passthrough();

const SortDirection = z.enum(['ASC', 'DESC']);

const FieldBase = z
  .object({
    fieldCaption: z.string(),
    fieldAlias: z.string().optional(),
    maxDecimalPlaces: z.number().int().optional(),
    sortDirection: SortDirection.optional(),
    sortPriority: z.number().int().optional(),
  })
  .passthrough();

const Field = z.union([FieldBase, FieldBase, FieldBase]);

const FilterField = z.union([
  z.object({ fieldCaption: z.string() }),
  z.object({ fieldCaption: z.string(), function: Function }),
  z.object({ calculation: z.string() }),
]);

const Filter = z
  .object({
    field: FilterField,
    filterType: z.enum([
      'QUANTITATIVE_DATE',
      'QUANTITATIVE_NUMERICAL',
      'SET',
      'MATCH',
      'DATE',
      'TOP',
    ]),
    context: z.boolean().optional().default(false),
  })
  .passthrough();

export const Query = z.object({
  fields: z.array(Field),
  filters: z.array(Filter).optional(),
});

const QueryDatasourceOptions = QueryOptions.and(
  z
    .object({
      disaggregate: z.boolean().default(false),
    })
    .partial()
    .passthrough(),
);

export const QueryRequest = z
  .object({
    datasource: Datasource,
    query: Query,
    options: QueryDatasourceOptions.optional(),
  })
  .passthrough();

export const QueryOutput = z
  .object({
    data: z.array(z.unknown()),
  })
  .partial()
  .passthrough();

const vizqlDataServiceApi = makeApi([
  {
    method: 'post',
    path: '/query-datasource',
    alias: 'queryDatasource',
    description: `Queries a specific data source and returns the resulting data.`,
    requestFormat: 'json',
    parameters: [
      {
        name: 'body',
        type: 'Body',
        schema: QueryRequest,
      },
    ],
    response: QueryOutput,
  },
  {
    method: 'post',
    path: '/read-metadata',
    alias: 'readMetadata',
    description: `Requests metadata for a specific data source. The metadata provides information about the data fields, such as field names, data types, and descriptions.`,
    requestFormat: 'json',
    parameters: [
      {
        name: 'body',
        type: 'Body',
        schema: ReadMetadataRequest,
      },
    ],
    response: MetadataOutput,
  },
  {
    method: 'get',
    path: '/simple-request',
    alias: 'simpleRequest',
    description: `Sends a request that can be used for testing or doing a health check.`,
    requestFormat: 'json',
    response: z.string(),
  },
]);

export const vizqlDataServiceApis = [
  ...vizqlDataServiceApi,
] as const satisfies ZodiosEndpointDefinitions;
