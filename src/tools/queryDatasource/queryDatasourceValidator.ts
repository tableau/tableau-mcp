import { z } from 'zod';

import { FilterField, Query } from '../../sdks/tableau/apis/vizqlDataServiceApi.js';
import { validateDatasourceLuid } from '../validateDatasourceLuid.js';
import { validateFields } from './validators/validateFields.js';

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

  const { fields } = query;
  validateFields(fields);
}
