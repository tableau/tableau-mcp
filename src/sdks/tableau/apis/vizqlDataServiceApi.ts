import { makeApi, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

const Connection = z.object({
  connectionLuid: z.string().optional(),
  connectionUsername: z.string(),
  connectionPassword: z.string(),
});

export const Datasource = z.object({
  datasourceLuid: z.string().nonempty(),
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

export const Function = z.enum([
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

const DataType = z.enum([
  'INTEGER',
  'REAL',
  'STRING',
  'DATETIME',
  'BOOLEAN',
  'DATE',
  'SPATIAL',
  'UNKNOWN',
]);

const PeriodType = z.enum(['MINUTES', 'HOURS', 'DAYS', 'WEEKS', 'MONTHS', 'QUARTERS', 'YEARS']);

const FieldMetadata = z
  .object({
    fieldName: z.string(),
    fieldCaption: z.string(),
    dataType: DataType,
    defaultAggregation: Function,
    columnClass: z.enum(['COLUMN', 'BIN', 'GROUP', 'CALCULATION', 'TABLE_CALCULATION']),
    formula: z.string(),
    logicalTableId: z.string(),
  })
  .partial()
  .passthrough();

const ParameterValue = z.union([z.number(), z.string(), z.boolean(), z.null()]);

const ParameterBase = z.object({
  parameterCaption: z.string(),
  dataType: DataType.exclude(['DATETIME', 'SPATIAL', 'UNKNOWN']),
  parameterName: z.string().optional(),
  value: ParameterValue,
});

const Parameter = z.discriminatedUnion('parameterType', [
  ParameterBase.extend({ parameterType: z.literal('ANY_VALUE') }).strict(),
  ParameterBase.extend({
    parameterType: z.literal('LIST'),
    members: z.array(ParameterValue),
  }).strict(),
  ParameterBase.extend({
    parameterType: z.literal('QUANTITATIVE_DATE'),
    value: z.string().nullable(),
    minDate: z.string().nullish(),
    maxDate: z.string().nullish(),
    periodValue: z.number().nullish(),
    periodType: PeriodType.nullish(),
  }).strict(),
  ParameterBase.extend({
    parameterType: z.literal('QUANTITATIVE_RANGE'),
    value: z.number().nullable(),
    min: z.number().nullish(),
    max: z.number().nullish(),
    step: z.number().nullish(),
  }).strict(),
]);

export const MetadataOutput = z
  .object({
    data: z.array(FieldMetadata),
    extraData: z.object({
      parameters: z.array(Parameter),
    }),
  })
  .partial()
  .passthrough();

export type FieldMetadata = z.infer<typeof FieldMetadata>;
export type MetadataResponse = z.infer<typeof MetadataOutput>;

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

export type TableauError = z.infer<typeof TableauError>;

const SortDirection = z.enum(['ASC', 'DESC']);

const FieldBase = z.object({
  fieldCaption: z.string(),
  fieldAlias: z.string().optional(),
  maxDecimalPlaces: z.number().int().optional(),
  sortDirection: SortDirection.optional(),
  sortPriority: z.number().int().optional(),
});

export const Field = z.union([
  FieldBase.strict(),
  FieldBase.extend({ function: Function }).strict(),
  FieldBase.extend({ calculation: z.string() }).strict(),
]);

export const FilterField = z.union([
  z.object({ fieldCaption: z.string() }).strict(),
  z.object({ fieldCaption: z.string(), function: Function }).strict(),
  z.object({ calculation: z.string() }).strict(),
]);

const FilterBase = z.object({
  field: FilterField,
  context: z.boolean().optional(),
});

const SimpleFilterBase = z.object({
  field: z.object({ fieldCaption: z.string() }).strict(),
  context: z.boolean().optional(),
});

export const SetFilter = SimpleFilterBase.extend({
  filterType: z.literal('SET'),
  values: z.union([z.array(z.string()), z.array(z.number()), z.array(z.boolean())]),
  exclude: z.boolean().optional(),
});

const RelativeDateFilterBase = SimpleFilterBase.extend({
  filterType: z.literal('DATE'),
  periodType: PeriodType,
  anchorDate: z.string().optional(),
  includeNulls: z.boolean().optional(),
});

const RelativeDateFilter = z.discriminatedUnion('dateRangeType', [
  RelativeDateFilterBase.extend({ dateRangeType: z.literal('CURRENT') }).strict(),
  RelativeDateFilterBase.extend({ dateRangeType: z.literal('LAST') }).strict(),
  RelativeDateFilterBase.extend({ dateRangeType: z.literal('NEXT') }).strict(),
  RelativeDateFilterBase.extend({ dateRangeType: z.literal('TODATE') }).strict(),
  RelativeDateFilterBase.extend({
    dateRangeType: z.literal('LASTN'),
    rangeN: z.number().int(),
  }).strict(),
  RelativeDateFilterBase.extend({
    dateRangeType: z.literal('NEXTN'),
    rangeN: z.number().int(),
  }).strict(),
]);

const MatchFilterBase = SimpleFilterBase.extend({
  filterType: z.literal('MATCH'),
  startsWith: z.string().optional(),
  endsWith: z.string().optional(),
  contains: z.string().optional(),
  exclude: z.boolean().optional(),
});

export const MatchFilter = z.union([
  MatchFilterBase.extend({ startsWith: z.string() }).strict(),
  MatchFilterBase.extend({ endsWith: z.string() }).strict(),
  MatchFilterBase.extend({ contains: z.string() }).strict(),
]);

const QuantitativeNumericalFilterBase = FilterBase.extend({
  filterType: z.literal('QUANTITATIVE_NUMERICAL'),
});

const QuantitativeNumericalFilter = z.discriminatedUnion('quantitativeFilterType', [
  QuantitativeNumericalFilterBase.extend({
    quantitativeFilterType: z.literal('RANGE'),
    min: z.number(),
    max: z.number(),
    includeNulls: z.boolean().optional(),
  }).strict(),
  QuantitativeNumericalFilterBase.extend({
    quantitativeFilterType: z.literal('MIN'),
    min: z.number(),
    includeNulls: z.boolean().optional(),
  }).strict(),
  QuantitativeNumericalFilterBase.extend({
    quantitativeFilterType: z.literal('MAX'),
    max: z.number(),
    includeNulls: z.boolean().optional(),
  }).strict(),
  QuantitativeNumericalFilterBase.extend({
    quantitativeFilterType: z.literal('ONLY_NULL'),
  }).strict(),
  QuantitativeNumericalFilterBase.extend({
    quantitativeFilterType: z.literal('ONLY_NON_NULL'),
  }).strict(),
]);

const QuantitativeDateFilterBase = FilterBase.extend({
  filterType: z.literal('QUANTITATIVE_DATE'),
});

const QuantitativeDateFilter = z.discriminatedUnion('quantitativeFilterType', [
  QuantitativeDateFilterBase.extend({
    quantitativeFilterType: z.literal('RANGE'),
    minDate: z.string(),
    maxDate: z.string(),
    includeNulls: z.boolean().optional(),
  }).strict(),
  QuantitativeDateFilterBase.extend({
    quantitativeFilterType: z.literal('MIN'),
    minDate: z.string(),
    includeNulls: z.boolean().optional(),
  }).strict(),
  QuantitativeDateFilterBase.extend({
    quantitativeFilterType: z.literal('MAX'),
    maxDate: z.string(),
    includeNulls: z.boolean().optional(),
  }).strict(),
  QuantitativeDateFilterBase.extend({
    quantitativeFilterType: z.literal('ONLY_NULL'),
  }).strict(),
  QuantitativeDateFilterBase.extend({
    quantitativeFilterType: z.literal('ONLY_NON_NULL'),
  }).strict(),
]);

export const TopNFilter = FilterBase.extend({
  filterType: z.literal('TOP'),
  howMany: z.number().int(),
  fieldToMeasure: FilterField,
  direction: z.enum(['TOP', 'BOTTOM']).optional().default('TOP'),
});

export const Filter = z.union([
  SetFilter.strict(),
  TopNFilter.strict(),
  ...MatchFilter.options,
  ...QuantitativeNumericalFilter.options,
  ...QuantitativeDateFilter.options,
  ...RelativeDateFilter.options,
]);

export const Query = z.strictObject({
  fields: z.array(Field),
  filters: z.array(Filter).optional(),
});

const QueryDatasourceOptions = QueryOptions.and(
  z
    .object({
      disaggregate: z.boolean(),
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

export type QueryOutput = z.infer<typeof QueryOutput>;

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
    errors: [
      {
        status: 'default',
        schema: TableauError,
      },
      {
        status: 404,
        schema: z.any(),
      },
    ],
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
    errors: [
      {
        status: 404,
        schema: z.any(),
      },
    ],
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
