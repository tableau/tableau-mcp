import { Query, querySchema } from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { ToolRules } from '../tool.js';
import { validateDatasourceLuid } from '../validateDatasourceLuid.js';
import { validateFields } from './validators/validateFields.js';
import { validateFilters } from './validators/validateFilters.js';

export function validateQueryWithRules(
  rules: ToolRules,
): ({ datasourceLuid, query }: { datasourceLuid: string; query: Query }) => void {
  return ({ datasourceLuid, query }: { datasourceLuid: string; query: Query }) => {
    validateQuery({ datasourceLuid, query, rules });
  };
}

export function validateQuery({
  datasourceLuid,
  query,
  rules,
}: {
  datasourceLuid: string;
  query: Query;
  rules: ToolRules;
}): void {
  validateDatasourceLuid({ datasourceLuid });

  const { fields, filters } = query;
  validateFields(fields);
  validateFilters(filters, rules);

  const result = querySchema.safeParse(query);
  if (!result.success) {
    throw new Error('The query does not match the expected schema.');
  }
}
