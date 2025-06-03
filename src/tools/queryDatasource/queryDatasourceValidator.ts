import { z } from 'zod';

import { FilterField, Query } from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { validateDatasourceLuid } from '../validateDatasourceLuid.js';
import { validateFields } from './validators/validateFields.js';
import { validateFilters } from './validators/validateFilters.js';

export type Query = z.infer<typeof Query>;
export type FilterField = z.infer<typeof FilterField>;

export function validateQuery({
  datasourceLuid,
  query,
}: {
  datasourceLuid: string;
  query: Query;
}): void {
  validateDatasourceLuid({ datasourceLuid });

  const { fields, filters } = query;
  validateFields(fields);
  validateFilters(filters);

  const result = Query.safeParse(query);
  if (!result.success) {
    throw new Error(`The query does not match the expected schema.`);
  }
}
