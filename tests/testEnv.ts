import dotenv from 'dotenv';
import { existsSync } from 'fs';

import { ProcessEnvEx } from '../types/process-env.js';
import { Datasource, getDatasource, getWorkbook, Workbook } from './constants.js';

type EnvValues = Record<keyof ProcessEnvEx, string>;

export function setEnv(): void {
  if (existsSync('.env')) {
    throw new Error(
      'Please remove or rename the .env file at the base of the project before running the tests.',
    );
  }

  dotenv.config({ path: 'tests/.env', override: true });
}

export function resetEnv(): void {
  dotenv.config({ path: 'tests/.env.reset', override: true });
}

export function getEnv(envKeys: Array<keyof ProcessEnvEx>): EnvValues {
  return envKeys.reduce(
    (acc, key) => {
      acc[key] = process.env[key] ?? '';
      return acc;
    },
    {} as Record<keyof ProcessEnvEx, string>,
  );
}

export function getDefaultEnv(): EnvValues {
  return getEnv([
    'SERVER',
    'SITE_NAME',
    'AUTH',
    'JWT_SUB_CLAIM',
    'CONNECTED_APP_CLIENT_ID',
    'CONNECTED_APP_SECRET_ID',
    'CONNECTED_APP_SECRET_VALUE',
  ]);
}

export function getSuperstoreDatasource(env?: EnvValues): Datasource {
  const { SERVER, SITE_NAME } = env ?? getDefaultEnv();
  return getDatasource(SERVER, SITE_NAME, 'Superstore Datasource');
}

export function getSuperstoreWorkbook(env?: EnvValues): Workbook {
  const { SERVER, SITE_NAME } = env ?? getDefaultEnv();
  return getWorkbook(SERVER, SITE_NAME, 'Superstore');
}
