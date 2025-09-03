import { writeFileSync } from 'fs';
import { ProcessEnvEx } from '../types/process-env.js';
import { randomUUID } from 'crypto';

export function writeConfigJson(env: Partial<ProcessEnvEx>): string {
  const config = {
    mcpServers: {
      tableau: {
        command: 'node',
        args: ['build/index.js'],
        env,
      },
    },
  };

  const filename = `config.${randomUUID()}.test.json`;
  writeFileSync(filename, JSON.stringify(config, null, 2));
  return filename;
}
