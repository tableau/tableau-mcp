import { z } from 'zod';

import {
  Datasource,
  getDatasource,
  getPulseDefinition,
  getWorkbook,
  PulseDefinition,
  Workbook,
} from '../../../constants.js';

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

export function getTableauMcpPulseDefinition(): PulseDefinition {
  const { SERVER, TEST_SITE_NAME } = z
    .object({
      SERVER: z.string(),
      TEST_SITE_NAME: z.string(),
    })
    .parse(process.env);

  return getPulseDefinition(SERVER, TEST_SITE_NAME, 'Tableau MCP');
}
