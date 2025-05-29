import { z } from 'zod';

import { validateDatasourceLuid } from '../validateDatasourceLuid.js';
import { DatasourceQuery } from './querySchemas.js';
import { validateFields } from './validators/validateFields.js';

export type DatasourceQuery = z.infer<typeof DatasourceQuery>;

export function validateQuery({
  datasourceLuid,
  query,
}: {
  datasourceLuid: string;
  query: DatasourceQuery;
}): void {
  validateDatasourceLuid({ datasourceLuid });

  const { fields } = query;
  validateFields(fields);
}
