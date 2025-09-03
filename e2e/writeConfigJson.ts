import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';

import { ProcessEnvEx } from '../types/process-env.js';

export function writeConfigJson({
  env,
  describe,
}: {
  env: Partial<ProcessEnvEx>;
  describe: string;
}): { filename: string } {
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
