import { randomUUID } from 'crypto';
import { globSync, unlinkSync, writeFileSync } from 'fs';

import { ProcessEnvEx } from '../types/process-env.js';

export function writeConfigJson({
  describe,
  env,
}: {
  describe: string;
  env?: Partial<Record<keyof ProcessEnvEx, string>>;
}): { filename: string } {
  env = env ?? {};

  const config = {
    mcpServers: {
      tableau: {
        command: 'node',
        args: ['build/index.js'],
        env,
      },
    },
  };

  const filename = `config.${describe}.${randomUUID()}.test.json`;
  writeFileSync(filename, JSON.stringify(config, null, 2));
  return { filename };
}

export function deleteConfigJsons(describe: string): void {
  const configJsons = globSync(`config.${describe}.*test.json`);
  configJsons.forEach(unlinkSync);
}
