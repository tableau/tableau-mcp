import { serverName, serverVersion } from '../../src/server.js';
import { toolNames } from '../../src/tools/toolName.js';
import { resetEnv, setEnv } from '../testEnv.js';
import { getClient, listTools } from './client.js';

describe('server', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

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
