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
      members: z.array(
        parameterValueSchema.or(
          z.object({ value: parameterValueSchema, alias: z.string().optional() }),
        ),
      ),
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
const binFieldSchema = fieldBaseSchema.extend({ binSize: z.number().gt(0) }).strict();

// Table calculation schemas
const tableCalcFieldReferenceSchema = z
  .object({ fieldCaption: z.string(), function: functionSchema.optional() })
  .strict();

const tableCalcCustomSortSchema = z
  .object({ fieldCaption: z.string(), function: functionSchema, direction: sortDirectionSchema })
  .strict();

// VDS treats UNSPECIFIED (2026.2+) as unset.
const tableCalcComputedAggregationSchema = z.enum(['UNSPECIFIED', 'SUM', 'AVG', 'MIN', 'MAX']);
const tableCalcRelativeToSchema = z.enum(['UNSPECIFIED', 'PREVIOUS', 'NEXT', 'FIRST', 'LAST']);
const tableCalcRankTypeSchema = z.enum([
  'UNSPECIFIED',
  'COMPETITION',
  'MODIFIED COMPETITION',
  'DENSE',
  'UNIQUE',
]);

const tableCalcSpecificationBaseSchema = z.object({
  dimensions: z.array(tableCalcFieldReferenceSchema),
});

const differenceTableCalcProperties = {
  levelAddress: tableCalcFieldReferenceSchema.optional(),
  relativeTo: tableCalcRelativeToSchema.optional(),
  customSort: tableCalcCustomSortSchema.optional(),
};

// Upstream allows any spec as a secondary, recursively. VDS only accepts these six, and only
// one level deep. Capping it also keeps $ref cycles out of the tool's JSON schema.
const secondaryTableCalcSpecificationSchema = z.discriminatedUnion('tableCalcType', [
  tableCalcSpecificationBaseSchema
    .extend({ tableCalcType: z.literal('DIFFERENCE_FROM'), ...differenceTableCalcProperties })
    .strict(),
  tableCalcSpecificationBaseSchema
    .extend({
      tableCalcType: z.literal('PERCENT_DIFFERENCE_FROM'),
      ...differenceTableCalcProperties,
    })
    .strict(),
  tableCalcSpecificationBaseSchema
    .extend({ tableCalcType: z.literal('PERCENT_FROM'), ...differenceTableCalcProperties })
    .strict(),
  tableCalcSpecificationBaseSchema
    .extend({
      tableCalcType: z.literal('PERCENT_OF_TOTAL'),
      levelAddress: tableCalcFieldReferenceSchema.optional(),
      customSort: tableCalcCustomSortSchema.optional(),
    })
    .strict(),
  tableCalcSpecificationBaseSchema
    .extend({
      tableCalcType: z.literal('RANK'),
      rankType: tableCalcRankTypeSchema.optional(),
      direction: sortDirectionSchema.optional(),
    })
    .strict(),
  tableCalcSpecificationBaseSchema
    .extend({ tableCalcType: z.literal('PERCENTILE'), direction: sortDirectionSchema.optional() })
    .strict(),
]);

export const tableCalcSpecificationSchema = z.discriminatedUnion('tableCalcType', [
  tableCalcSpecificationBaseSchema
    .extend({
      tableCalcType: z.literal('CUSTOM'),
      levelAddress: tableCalcFieldReferenceSchema.optional(),
      restartEvery: tableCalcFieldReferenceSchema.optional(),
      customSort: tableCalcCustomSortSchema.optional(),
    })
    .strict(),
  tableCalcSpecificationBaseSchema
    .extend({
      tableCalcType: z.literal('NESTED'),
      fieldCaption: z.string(),
      levelAddress: tableCalcFieldReferenceSchema.optional(),
      restartEvery: tableCalcFieldReferenceSchema.optional(),
      customSort: tableCalcCustomSortSchema.optional(),
    })
    .strict(),
  ...secondaryTableCalcSpecificationSchema.options,
  tableCalcSpecificationBaseSchema
    .extend({
      tableCalcType: z.literal('RUNNING_TOTAL'),
      aggregation: tableCalcComputedAggregationSchema.optional(),
      restartEvery: tableCalcFieldReferenceSchema.optional(),
      customSort: tableCalcCustomSortSchema.optional(),
      secondaryTableCalculation: secondaryTableCalcSpecificationSchema.optional(),
    })
    .strict(),
  tableCalcSpecificationBaseSchema
    .extend({
      tableCalcType: z.literal('MOVING_CALCULATION'),
      aggregation: tableCalcComputedAggregationSchema.optional(),
      previous: z.number().int().optional(),
      next: z.number().int().optional(),
      includeCurrent: z.boolean().optional(),
      fillInNull: z.boolean().optional(),
      customSort: tableCalcCustomSortSchema.optional(),
      secondaryTableCalculation: secondaryTableCalcSpecificationSchema.optional(),
    })
    .strict(),
]);

const tableCalcFieldSchema = fieldBaseSchema
  .extend({
    function: functionSchema.optional(),
    calculation: z.string().optional(),
    tableCalculation: tableCalcSpecificationSchema,
    nestedTableCalculations: z.array(tableCalcSpecificationSchema).nullable().optional(),
  })
  .strict();

export const fieldSchema = z.union([
  // First: Zod 3 reports the first strict variant that fails only on unknown keys, so a table
  // calc listed later gets the dimension variant's "unrecognized keys" error instead of its own.
  tableCalcFieldSchema,
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
  field: z.union([dimensionFilterFieldSchema, calculatedFilterFieldSchema]),
  context: z.boolean().optional(),
});

export const setFilterSchema = filterBaseSchema.extend({
  filterType: z.literal('SET'),
  // Narrower than upstream's NullableAny: VDS can't match objects or arrays.
  values: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  exclude: z.boolean().optional(),
});

const relativeDateFilterBaseSchema = filterBaseSchema.extend({
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

// Upstream leaves condition and calculation both optional; validateFilters requires exactly one.
export const conditionFilterSchema = filterBaseSchema.extend({
  filterType: z.literal('CONDITION'),
  condition: z
    .object({
      fieldCaption: z.string(),
      function: functionSchema,
      comparison: z.enum(['=', '<>', '<', '<=', '>', '>=']),
      value: z.union([z.number(), z.string()]),
    })
    .strict()
    .optional(),
  calculation: z.string().optional(),
});

export const filterSchema = z.union([
  setFilterSchema.strict(),
  topNFilterSchema.strict(),
  conditionFilterSchema.strict(),
  ...matchFilterSchema.options,
  ...quantitativeNumericalFilterSchema.options,
  ...quantitativeDateFilterSchema.options,
  ...relativeDateFilterSchema.options,
]);

// VDS API schemas
const queryParameterSchema = z.object({
  parameterCaption: z.string(),
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

export const getDatasourceModelRequestSchema = z
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

const logicalTableSchema = z
  .object({
    logicalTableId: z.string(),
    caption: z.string().optional(),
    description: z.string().optional(),
  })
  .passthrough();

const relationshipClauseSchema = z
  .object({
    operator: z.string(),
    fromField: z.string(),
    toField: z.string(),
  })
  .passthrough();

const logicalTableRelationshipSchema = z
  .object({
    fromLogicalTable: z
      .object({
        logicalTableId: z.string(),
      })
      .passthrough(),
    toLogicalTable: z
      .object({
        logicalTableId: z.string(),
      })
      .passthrough(),
    expression: z
      .object({
        op: z.string().optional(),
        relationships: z.array(relationshipClauseSchema),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const datasourceModelResponseSchema = z
  .object({
    logicalTables: z.array(logicalTableSchema),
    logicalTableRelationships: z.array(logicalTableRelationshipSchema),
  })
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
      rowLimit: z.number().int().min(1).optional(),
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

export const userHasQueryPermissionsRequestSchema = z
  .object({
    datasource: datasourceSchema,
  })
  .passthrough();

const queryPermissionCapabilitySchema = z
  .object({
    name: z.string(),
    mode: z.enum(['Allow', 'Deny']),
  })
  .passthrough();

const queryPermissionResourceSchema = z
  .object({
    resourceType: z.string().optional(),
    luid: z.string().optional(),
    capabilities: z.array(queryPermissionCapabilitySchema).optional(),
  })
  .passthrough();

// resources/datasourceType explain a denial (used to build get-workbook's queryability reason).
export const queryPermissionsOutputSchema = z
  .object({
    hasQueryPermission: z.boolean(),
    datasourceType: z.string().optional(),
    resources: z.array(queryPermissionResourceSchema).optional(),
  })
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
export type ConditionFilter = z.infer<typeof conditionFilterSchema>;
export type TableCalcField = z.infer<typeof tableCalcFieldSchema>;
export type TableCalcSpecification = z.infer<typeof tableCalcSpecificationSchema>;

export type Parameter = z.infer<typeof parameterSchema>;

export type Query = z.infer<typeof querySchema>;
export type QueryOutput = z.infer<typeof queryOutputSchema>;
export type QueryRequest = z.infer<typeof queryRequestSchema>;
export type QueryParameter = z.infer<typeof queryParameterSchema>;

export type ReadMetadataRequest = z.infer<typeof readMetadataRequestSchema>;
export type GetDatasourceModelRequest = z.infer<typeof getDatasourceModelRequestSchema>;
export type DatasourceModelResponse = z.infer<typeof datasourceModelResponseSchema>;

export type UserHasQueryPermissionsRequest = z.infer<typeof userHasQueryPermissionsRequestSchema>;
export type QueryPermissionsOutput = z.infer<typeof queryPermissionsOutputSchema>;
export type QueryPermissionResource = z.infer<typeof queryPermissionResourceSchema>;

export type TableauError = z.infer<typeof tableauErrorSchema>;

// Endpoints & APIs
const queryDatasourceEndpoint = makeEndpoint({
  method: 'post',
  path: '/query-datasource',
  alias: 'queryDatasource',
  description: 'Queries a specific data source and returns the resulting data.',
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
  description:
    "Requests metadata for a specific data source. The metadata provides information about the data fields, such as field names, data types, and descriptions.','Requests metadata for a specific data source. The metadata provides information about the data fields, such as field names, data types, and descriptions.",
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
    // The workbook opt-in gate (VDSForWorkbookDatasources) arrives as HTTP 403; declare a default
    // error so isErrorFromAlias recognizes it and readMetadata can classify it (mirrors
    // queryDatasource). Without this the 403 slips past the alias check and rethrows.
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

const getDatasourceModelEndpoint = makeEndpoint({
  method: 'post',
  path: '/get-datasource-model',
  alias: 'getDatasourceModel',
  description:
    'Requests the data model for a specific data source, including logical tables and relationships.',
  requestFormat: 'json',
  parameters: [
    {
      name: 'body',
      type: 'Body',
      schema: getDatasourceModelRequestSchema,
    },
  ],
  response: datasourceModelResponseSchema,
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
  description: 'Sends a request that can be used for testing or doing a health check.',
  requestFormat: 'json',
  response: z.string(),
});

const userHasQueryPermissionsEndpoint = makeEndpoint({
  method: 'post',
  path: '/user-has-query-permissions',
  alias: 'userHasQueryPermissions',
  description:
    'Checks whether the calling user has permission to query the specified data source via the VizQL Data Service.',
  requestFormat: 'json',
  parameters: [
    {
      name: 'body',
      type: 'Body',
      schema: userHasQueryPermissionsRequestSchema,
    },
  ],
  response: queryPermissionsOutputSchema,
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

const vizqlDataServiceApi = makeApi([
  queryDatasourceEndpoint,
  readMetadataEndpoint,
  getDatasourceModelEndpoint,
  simpleRequestEndpoint,
  userHasQueryPermissionsEndpoint,
]);

export const vizqlDataServiceApis = [
  ...vizqlDataServiceApi,
] as const satisfies ZodiosEndpointDefinitions;
