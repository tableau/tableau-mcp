import dotenv from 'dotenv';

import { ProcessEnvEx } from '../types/process-env.js';

export function setEnv(): void {
  dotenv.config({ path: 'e2e/.env', override: true });
}

export function resetEnv(): void {
  dotenv.config({ path: 'e2e/.env.reset', override: true });
}

export function getEnv(envKeys: Array<keyof ProcessEnvEx>): Record<keyof ProcessEnvEx, string> {
  return envKeys.reduce(
    (acc, key) => {
      acc[key] = process.env[key] ?? '';
      return acc;
    },
    {} as Record<keyof ProcessEnvEx, string>,
  );
}
