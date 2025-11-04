import { Query, querySchema } from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { validateDatasourceLuid } from '../validateDatasourceLuid.js';
import { validateFields } from './validators/validateFields.js';
import { validateFilters } from './validators/validateFilters.js';

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

  const result = querySchema.safeParse(query);
  if (!result.success) {
    throw new Error(`The query does not match the expected schema.`);
  }
}
