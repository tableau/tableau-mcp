import { globSync, unlinkSync } from 'node:fs';

import dotenv from 'dotenv';

export function setEnv(): void {
  dotenv.config({ path: 'e2e/.env', override: true });
}

export function resetEnv(): void {
  dotenv.config({ path: 'e2e/.env.reset', override: true });
}

export function deleteConfigJsons(describe: string): void {
  const configJsons = globSync(`config.${describe}.*test.json`);
  configJsons.forEach(unlinkSync);
}
