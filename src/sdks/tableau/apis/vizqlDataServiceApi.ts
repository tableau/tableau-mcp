import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

export const functionSchema = z.enum([
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

const dataTypeSchema = z.enum([
  'INTEGER',
  'REAL',
  'STRING',
  'DATETIME',
  'BOOLEAN',
  'DATE',
  'SPATIAL',
  'UNKNOWN',
]);

const periodTypeSchema = z.enum([
  'MINUTES',
  'HOURS',
  'DAYS',
  'WEEKS',
  'MONTHS',
  'QUARTERS',
  'YEARS',
]);

const columnClassSchema = z.enum(['COLUMN', 'BIN', 'GROUP', 'CALCULATION', 'TABLE_CALCULATION']);

const fieldMetadataSchema = z
  .object({
    fieldName: z.string(),
    fieldCaption: z.string(),
    dataType: dataTypeSchema,
    defaultAggregation: functionSchema,
    columnClass: columnClassSchema,
    formula: z.string(),
    logicalTableId: z.string(),
  })
  .partial()
  .passthrough();

// Parameter schemas
const parameterValueSchema = z.union([z.number(), z.string(), z.boolean(), z.null()]);

const parameterBaseSchema = z.object({
  parameterCaption: z.string(),
  dataType: dataTypeSchema.exclude(['DATETIME', 'SPATIAL', 'UNKNOWN']),
  parameterName: z.string().optional(),
  value: parameterValueSchema,
});

const parameterSchema = z.discriminatedUnion('parameterType', [
  parameterBaseSchema.extend({ parameterType: z.literal('ANY_VALUE') }).strict(),
  parameterBaseSchema
    .extend({
      parameterType: z.literal('LIST'),
      members: z.array(parameterValueSchema),
    })
    .strict(),
  parameterBaseSchema
    .extend({
      parameterType: z.literal('QUANTITATIVE_DATE'),
      value: z.string().nullable(),
      minDate: z.string().nullish(),
      maxDate: z.string().nullish(),
      periodValue: z.number().nullish(),
      periodType: periodTypeSchema.nullish(),
    })
    .strict(),
  parameterBaseSchema
    .extend({
      parameterType: z.literal('QUANTITATIVE_RANGE'),
      value: z.number().nullable(),
      min: z.number().nullish(),
      max: z.number().nullish(),
      step: z.number().nullish(),
    })
    .strict(),
]);

// Field schemas
const sortDirectionSchema = z.enum(['ASC', 'DESC']);

const fieldBaseSchema = z.object({
  fieldCaption: z.string(),
  fieldAlias: z.string().optional(),
  maxDecimalPlaces: z.number().int().gte(0).optional(),
  sortDirection: sortDirectionSchema.optional(),
  sortPriority: z.number().int().gt(0).optional(),
});

const dimensionFieldSchema = fieldBaseSchema.strict();
const measureFieldSchema = fieldBaseSchema.extend({ function: functionSchema }).strict();
const calculatedFieldSchema = fieldBaseSchema.extend({ calculation: z.string() }).strict();
const binFieldSchema = fieldBaseSchema.extend({ binSize: z.number().int().gt(0) }).strict();

export const fieldSchema = z.union([
  dimensionFieldSchema,
  measureFieldSchema,
  calculatedFieldSchema,
  binFieldSchema,
]);

// Filter schemas
const dimensionFilterFieldSchema = z.object({ fieldCaption: z.string() }).strict();
const measureFilterFieldSchema = z
  .object({ fieldCaption: z.string(), function: functionSchema })
  .strict();
const calculatedFilterFieldSchema = z.object({ calculation: z.string() }).strict();

export const filterFieldSchema = z.union([
  dimensionFilterFieldSchema,
  measureFilterFieldSchema,
  calculatedFilterFieldSchema,
]);

const filterBaseSchema = z.object({
  field: filterFieldSchema,
  context: z.boolean().optional(),
});

const simpleFilterBaseSchema = z.object({
  field: z.object({ fieldCaption: z.string() }).strict(),
  context: z.boolean().optional(),
});

export const setFilterSchema = simpleFilterBaseSchema.extend({
  filterType: z.literal('SET'),
  values: z.union([z.array(z.string()), z.array(z.number()), z.array(z.boolean())]),
  exclude: z.boolean().optional(),
});

const relativeDateFilterBaseSchema = simpleFilterBaseSchema.extend({
  filterType: z.literal('DATE'),
  periodType: periodTypeSchema,
  anchorDate: z.string().optional(),
  includeNulls: z.boolean().optional(),
});

const relativeDateFilterSchema = z.discriminatedUnion('dateRangeType', [
  relativeDateFilterBaseSchema.extend({ dateRangeType: z.literal('CURRENT') }).strict(),
  relativeDateFilterBaseSchema.extend({ dateRangeType: z.literal('LAST') }).strict(),
  relativeDateFilterBaseSchema.extend({ dateRangeType: z.literal('NEXT') }).strict(),
  relativeDateFilterBaseSchema.extend({ dateRangeType: z.literal('TODATE') }).strict(),
  relativeDateFilterBaseSchema
    .extend({
      dateRangeType: z.literal('LASTN'),
      rangeN: z.number().int(),
    })
    .strict(),
  relativeDateFilterBaseSchema
    .extend({
      dateRangeType: z.literal('NEXTN'),
      rangeN: z.number().int(),
    })
    .strict(),
]);

const matchFilterBaseSchema = simpleFilterBaseSchema.extend({
  filterType: z.literal('MATCH'),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  contains: z.string().optional(),
  exclude: z.boolean().optional(),
});

export const matchFilterSchema = z.union([
  matchFilterBaseSchema.extend({ startsWith: z.string() }).strict(),
  matchFilterBaseSchema.extend({ endsWith: z.string() }).strict(),
  matchFilterBaseSchema.extend({ contains: z.string() }).strict(),
]);

const quantitativeNumericalFilterBaseSchema = filterBaseSchema.extend({
  filterType: z.literal('QUANTITATIVE_NUMERICAL'),
});

const quantitativeNumericalFilterSchema = z.discriminatedUnion('quantitativeFilterType', [
  quantitativeNumericalFilterBaseSchema
    .extend({
      quantitativeFilterType: z.literal('RANGE'),
      min: z.number(),
      max: z.number(),
      includeNulls: z.boolean().optional(),
    })
    .strict(),
  quantitativeNumericalFilterBaseSchema
    .extend({
      quantitativeFilterType: z.literal('MIN'),
      min: z.number(),
      includeNulls: z.boolean().optional(),
    })
    .strict(),
  quantitativeNumericalFilterBaseSchema
    .extend({
      quantitativeFilterType: z.literal('MAX'),
      max: z.number(),
      includeNulls: z.boolean().optional(),
    })
    .strict(),
  quantitativeNumericalFilterBaseSchema
    .extend({
      quantitativeFilterType: z.literal('ONLY_NULL'),
    })
    .strict(),
  quantitativeNumericalFilterBaseSchema
    .extend({
      quantitativeFilterType: z.literal('ONLY_NON_NULL'),
    })
    .strict(),
]);

const quantitativeDateFilterBaseSchema = filterBaseSchema.extend({
  filterType: z.literal('QUANTITATIVE_DATE'),
});

const quantitativeDateFilterSchema = z.discriminatedUnion('quantitativeFilterType', [
  quantitativeDateFilterBaseSchema
    .extend({
      quantitativeFilterType: z.literal('RANGE'),
      minDate: z.string(),
      maxDate: z.string(),
      includeNulls: z.boolean().optional(),
    })
    .strict(),
  quantitativeDateFilterBaseSchema
    .extend({
      quantitativeFilterType: z.literal('MIN'),
      minDate: z.string(),
      includeNulls: z.boolean().optional(),
    })
    .strict(),
  quantitativeDateFilterBaseSchema
    .extend({
      quantitativeFilterType: z.literal('MAX'),
      maxDate: z.string(),
      includeNulls: z.boolean().optional(),
    })
    .strict(),
  quantitativeDateFilterBaseSchema
    .extend({
      quantitativeFilterType: z.literal('ONLY_NULL'),
    })
    .strict(),
  quantitativeDateFilterBaseSchema
    .extend({
      quantitativeFilterType: z.literal('ONLY_NON_NULL'),
    })
    .strict(),
]);

export const topNFilterSchema = filterBaseSchema.extend({
  filterType: z.literal('TOP'),
  howMany: z.number().int(),
  fieldToMeasure: filterFieldSchema,
  direction: z.enum(['TOP', 'BOTTOM']).optional().default('TOP'),
});

export const filterSchema = z.union([
  setFilterSchema.strict(),
  topNFilterSchema.strict(),
  ...matchFilterSchema.options,
  ...quantitativeNumericalFilterSchema.options,
  ...quantitativeDateFilterSchema.options,
  ...relativeDateFilterSchema.options,
]);

// VDS API schemas
const queryParameterSchema = z.object({
  name: z.string(),
  value: parameterValueSchema,
});

const connectionSchema = z.object({
  connectionLuid: z.string().optional(),
  connectionUsername: z.string(),
  connectionPassword: z.string(),
});

export const datasourceSchema = z.object({
  datasourceLuid: z.string().nonempty(),
  connections: z.array(connectionSchema).optional(),
});

const returnFormatSchema = z.enum(['OBJECTS', 'ARRAYS']);

const queryOptionsSchema = z
  .object({
    returnFormat: returnFormatSchema,
    debug: z.boolean().default(false),
  })
  .partial()
  .passthrough();

export const readMetadataRequestSchema = z
  .object({
    datasource: datasourceSchema,
    options: queryOptionsSchema.optional(),
  })
  .passthrough();

export const metadataOutputSchema = z
  .object({
    data: z.array(fieldMetadataSchema),
    extraData: z.object({
      parameters: z.array(parameterSchema),
    }),
  })
  .partial()
  .passthrough();

export const tableauErrorSchema = z
  .object({
    errorCode: z.string(),
    message: z.string(),
    datetime: z.string().datetime({ offset: true }),
    debug: z.object({}).partial().passthrough(),
    'tab-error-code': z.string(),
  })
  .partial()
  .passthrough();

export const querySchema = z.strictObject({
  fields: z.array(fieldSchema),
  filters: z.array(filterSchema).optional(),
  parameters: z.array(queryParameterSchema).optional(),
});

const queryDatasourceOptionsSchema = queryOptionsSchema.and(
  z
    .object({
      disaggregate: z.boolean(),
    })
    .partial()
    .passthrough(),
);

export const queryRequestSchema = z
  .object({
    datasource: datasourceSchema,
    query: querySchema,
    options: queryDatasourceOptionsSchema.optional(),
  })
  .passthrough();

export const queryOutputSchema = z
  .object({
    data: z.array(z.unknown()),
  })
  .partial()
  .passthrough();

// Exported Types
export type Datasource = z.infer<typeof datasourceSchema>;
export type DataType = z.infer<typeof dataTypeSchema>;

export type Field = z.infer<typeof fieldSchema>;
export type FieldMetadata = z.infer<typeof fieldMetadataSchema>;
export type Filter = z.infer<typeof filterSchema>;
export type FilterField = z.infer<typeof filterFieldSchema>;

export type MetadataResponse = z.infer<typeof metadataOutputSchema>;
export type MatchFilter = z.infer<typeof matchFilterSchema>;

export type SetFilter = z.infer<typeof setFilterSchema>;

export type Parameter = z.infer<typeof parameterSchema>;

export type Query = z.infer<typeof querySchema>;
export type QueryOutput = z.infer<typeof queryOutputSchema>;
export type QueryRequest = z.infer<typeof queryRequestSchema>;
export type QueryParameter = z.infer<typeof queryParameterSchema>;

export type ReadMetadataRequest = z.infer<typeof readMetadataRequestSchema>;

export type TableauError = z.infer<typeof tableauErrorSchema>;

// Endpoints & APIs
const queryDatasourceEndpoint = makeEndpoint({
  method: 'post',
  path: '/query-datasource',
  alias: 'queryDatasource',
  description: `Queries a specific data source and returns the resulting data.`,
  requestFormat: 'json',
  parameters: [
    {
      name: 'body',
      type: 'Body',
      schema: queryRequestSchema,
    },
  ],
  response: queryOutputSchema,
  errors: [
    {
      status: 'default',
      schema: tableauErrorSchema,
    },
    {
      status: 404,
      schema: z.any(),
    },
  ],
});

const readMetadataEndpoint = makeEndpoint({
  method: 'post',
  path: '/read-metadata',
  alias: 'readMetadata',
  description: `Requests metadata for a specific data source. The metadata provides information about the data fields, such as field names, data types, and descriptions.`,
  requestFormat: 'json',
  parameters: [
    {
      name: 'body',
      type: 'Body',
      schema: readMetadataRequestSchema,
    },
  ],
  response: metadataOutputSchema,
  errors: [
    {
      status: 404,
      schema: z.any(),
    },
  ],
});

const simpleRequestEndpoint = makeEndpoint({
  method: 'get',
  path: '/simple-request',
  alias: 'simpleRequest',
  description: `Sends a request that can be used for testing or doing a health check.`,
  requestFormat: 'json',
  response: z.string(),
});

const vizqlDataServiceApi = makeApi([
  queryDatasourceEndpoint,
  readMetadataEndpoint,
  simpleRequestEndpoint,
]);

export const vizqlDataServiceApis = [
  ...vizqlDataServiceApi,
] as const satisfies ZodiosEndpointDefinitions;
