import { z } from 'zod';

import { Filter } from '../../sdks/tableau/apis/vizqlDataServiceApi.js';

const Functions = [
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
] as const;

const Function = z.enum(Functions);

const SortDirection = z.enum(['ASC', 'DESC']);

const Field = z.object({
  fieldCaption: z.string(),
  fieldAlias: z.string().optional(),
  maxDecimalPlaces: z.number().int().optional(),
  sortDirection: SortDirection.optional(),
  sortPriority: z.number().int().optional(),
  function: Function.optional(),
  calculation: z.string().optional(),
});

export const DatasourceQuery = z.object({
  fields: z.array(Field),
  filters: z.array(Filter).optional(),
});
