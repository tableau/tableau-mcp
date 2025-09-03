import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';

import { ProcessEnvEx } from '../types/process-env.js';

export function writeConfigJson({
  envKeys,
  describe,
}: {
  envKeys?: (keyof ProcessEnvEx)[];
  describe: string;
}): { filename: string } {
  envKeys = envKeys ?? [];

  const env = envKeys.reduce(
    (acc, key) => {
      acc[key] = process.env[key];
      return acc;
    },
    {} as Record<keyof ProcessEnvEx, string | undefined>,
  );

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
