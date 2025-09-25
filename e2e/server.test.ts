import { serverName, serverVersion } from '../src/server.js';
import { toolNames } from '../src/tools/toolName.js';
import { getClient, listTools } from './client.js';
import { resetEnv, setEnv } from './testEnv.js';

describe('server', () => {
  const toolsNotSupportedWithDirectTrust = ['search-content'];

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
    expect(names).toEqual(
      expect.arrayContaining([
        ...toolNames.filter((name) => !toolsNotSupportedWithDirectTrust.includes(name)),
      ]),
    );
    expect(names).toHaveLength(toolNames.length - toolsNotSupportedWithDirectTrust.length);
  });
});
