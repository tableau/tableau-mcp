import { z } from 'zod';

export const FunctionEnum = [
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

const Function = z.enum(FunctionEnum);

const SortDirection = z.enum(['ASC', 'DESC']);

export const Field = z.object({
  fieldCaption: z.string(),
  fieldAlias: z.string().optional(),
  maxDecimalPlaces: z.number().int().optional(),
  sortDirection: SortDirection.optional(),
  sortPriority: z.number().int().optional(),
  function: Function.optional(),
});

// const FilterBase = z.object({
//   field: z.string(),
// });

// filterType: z.enum([
//   'QUANTITATIVE_DATE',
//   'QUANTITATIVE_NUMERICAL',
//   'SET',
//   'MATCH',
//   'DATE',
//   'TOP',
// ])
// const Filter = z.union([
//   FilterBase,
//   FilterBase.and(z.object({ filterType: 'QUANTITATIVE_DATE', value: z.string() })),
// ]);
