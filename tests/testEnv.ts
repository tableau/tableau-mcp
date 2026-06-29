import dotenv from 'dotenv';
import { existsSync } from 'fs';

import { ProcessEnvWeb } from '../types/process-env.js';
import { Datasource, getDatasource, getWorkbook, Workbook } from './constants.js';

type EnvValues = Record<keyof ProcessEnvWeb, string>;

export function setEnv(): void {
  if (existsSync('.env')) {
    throw new Error(
      'Please remove or rename the .env file at the base of the project before running the tests.',
    );
  }

  dotenv.config({ path: 'tests/.env', override: true });
  if (!process.env.OAUTH_DISABLE_SCOPES) {
    process.env.OAUTH_DISABLE_SCOPES = 'true';
  }
}

export function resetEnv(): void {
  dotenv.config({ path: 'tests/.env.reset', override: true });
}

export function getEnv(envKeys: Array<keyof ProcessEnvWeb>): EnvValues {
  return envKeys.reduce(
    (acc, key) => {
      acc[key] = process.env[key] ?? '';
      return acc;
    },
    {} as Record<keyof ProcessEnvWeb, string>,
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
    // PAT auth keys: without these the spawned server child cannot start under AUTH=pat
    // (it exits with "PAT_NAME is not set"). Forwarded as '' when unset, so the connected-app
    // path is unaffected. ADMIN_TOOLS_ENABLED is intentionally NOT forwarded here — tests that
    // need admin tools inject it explicitly on their client env, and the negative
    // "tool absent when admin off" tests rely on getDefaultEnv() omitting it.
    'PAT_NAME',
    'PAT_VALUE',
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
