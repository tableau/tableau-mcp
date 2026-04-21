import { serverName, serverVersion } from '../../src/server.js';
import { WebToolName, webToolNames } from '../../src/tools/toolName.web.js';
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
    const oauthOnlyTools: ReadonlyArray<WebToolName> = ['revoke-access-token', 'reset-consent'];
    const expectedToolNames =
      process.env.AUTH === 'oauth'
        ? [...webToolNames]
        : webToolNames.filter((name) => !oauthOnlyTools.includes(name));
    expect(names).toEqual(expect.arrayContaining(expectedToolNames));
    expect(names).toHaveLength(expectedToolNames.length);
  });
});
