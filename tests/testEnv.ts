import dotenv from 'dotenv';
import { z } from 'zod';
import { fromError } from 'zod-validation-error/v3';

import {
  Datasource,
  getDatasource,
  getPulseDefinition,
  getWorkbook,
  PulseDefinition,
  Workbook,
} from './constants.js';

export function setEnv(): void {
  dotenv.config();
}

export function getEnv<Z extends z.ZodSchema>(schema: Z): z.infer<Z> {
  dotenv.config();

  const result = schema.safeParse(process.env);

  if (!result.success) {
    throw new Error(
      fromError(result.error, { prefix: 'Invalid environment variables' }).toString(),
    );
  }

  return result.data;
}

export function getSuperstoreDatasource(): Datasource {
  const { SERVER, SITE_NAME, TEST_SITE_NAME } = getEnv(
    z.object({
      SERVER: z.string(),
      SITE_NAME: z.string().optional(),
      TEST_SITE_NAME: z.string().optional(),
    }),
  );

  const siteName = SITE_NAME ?? TEST_SITE_NAME ?? '';
  return getDatasource(SERVER, siteName, 'Superstore Datasource');
}

export function getSuperstoreWorkbook(): Workbook {
  const { SERVER, SITE_NAME, TEST_SITE_NAME } = getEnv(
    z.object({
      SERVER: z.string(),
      SITE_NAME: z.string().optional(),
      TEST_SITE_NAME: z.string().optional(),
    }),
  );

  const siteName = SITE_NAME ?? TEST_SITE_NAME ?? '';
  return getWorkbook(SERVER, siteName, 'Superstore');
}

export function getTableauMcpPulseDefinition(): PulseDefinition {
  const { SERVER, SITE_NAME, TEST_SITE_NAME } = getEnv(
    z.object({
      SERVER: z.string(),
      SITE_NAME: z.string().optional(),
      TEST_SITE_NAME: z.string().optional(),
    }),
  );

  const siteName = SITE_NAME ?? TEST_SITE_NAME ?? '';
  return getPulseDefinition(SERVER, siteName, 'Tableau MCP');
}
