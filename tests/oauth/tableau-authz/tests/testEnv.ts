import { z } from 'zod';

import { Datasource, getDatasource, getWorkbook, Workbook } from '../../../constants';

export function getSuperstoreDatasource(): Datasource {
  const { SERVER, TEST_SITE_NAME } = z
    .object({
      SERVER: z.string(),
      TEST_SITE_NAME: z.string(),
    })
    .parse(process.env);

  return getDatasource(SERVER, TEST_SITE_NAME, 'Superstore Datasource');
}

export function getSuperstoreWorkbook(): Workbook {
  const { SERVER, TEST_SITE_NAME } = z
    .object({
      SERVER: z.string(),
      TEST_SITE_NAME: z.string(),
    })
    .parse(process.env);

  return getWorkbook(SERVER, TEST_SITE_NAME, 'Superstore');
}
