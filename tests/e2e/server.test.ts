import dotenv from 'dotenv';

import { serverName, serverVersion } from '../../src/server.js';
import { toolNames } from '../../src/tools/toolName.js';
import { getClient, listTools } from './client.js';

describe('server', () => {
  beforeAll(() => {
    dotenv.config();
  });

  it('should get server version', async () => {
    const client = await getClient();
    expect(client.getServerVersion()).toEqual({
      name: serverName,
      version: serverVersion,
    });
  });

  it('should list tools', async () => {
    const names = await listTools();
    expect(names).toEqual(expect.arrayContaining([...toolNames]));
    expect(names).toHaveLength(toolNames.length);
  });
});
