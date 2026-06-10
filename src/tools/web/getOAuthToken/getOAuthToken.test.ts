import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getOAuthTokenTool } from './getOAuthToken.js';

const MOCK_ISSUER = 'https://sso.online.tableau.com';
const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.dGVzdC1wYXlsb2Fk.signature';
const MOCK_SERVER = 'https://my-tableau-server.com';
const MOCK_CLIENT_ID = 'https://client.dev/oauth/metadata.json';

describe('getOAuthTokenTool', () => {
  it('should create a tool instance with correct properties', async () => {
    const tool = getOAuthTokenTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    expect(tool.name).toBe('get-oauth-token');
    expect(tool.paramsSchema).toEqual({});
    expect(annotations?.readOnlyHint).toBe(true);
    expect(annotations?.openWorldHint).toBe(false);
  });

  it('should set visibility to app-only', async () => {
    const tool = getOAuthTokenTool(new WebMcpServer());
    const meta = await Provider.from(tool.meta);
    expect(meta?.ui?.visibility).toEqual(['app']);
  });

  it('should return an error when tableauAuthInfo is missing', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.tableauAuthInfo = undefined;
    const result = await getToolResult(extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Bearer authentication');
    expect(result.content[0].text).toContain('Tableau OAuth server mode');
  });

  describe('Bearer auth (Tableau authZ server mode)', () => {
    function makeBearerExtra(): ReturnType<typeof getMockRequestHandlerExtra> {
      const extra = getMockRequestHandlerExtra();
      extra.config.oauth.issuer = MOCK_ISSUER;
      extra.tableauAuthInfo = {
        type: 'Bearer',
        raw: MOCK_TOKEN,
        username: 'test@example.com',
        server: MOCK_ISSUER,
        siteId: 'test-site-id',
        clientId: MOCK_CLIENT_ID,
      };
      return extra;
    }

    it('should return the Bearer token from tableauAuthInfo', async () => {
      const result = await getToolResult(makeBearerExtra());

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const response = JSON.parse(result.content[0].text);
      expect(response.token).toBe(MOCK_TOKEN);
      expect(response.tokenType).toBe('Bearer');
    });
  });

  describe('unsupported auth', () => {
    it('should return an error for X-Tableau-Auth', async () => {
      const extra = getMockRequestHandlerExtra();
      extra.config.oauth.issuer = MOCK_ISSUER;
      extra.tableauAuthInfo = {
        type: 'X-Tableau-Auth',
        username: 'test-user',
        server: MOCK_SERVER,
        siteId: 'site-id',
        accessToken: 'tableau-access-token',
        refreshToken: 'tableau-refresh-token',
      };
      const result = await getToolResult(extra);

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Bearer authentication');
      expect(result.content[0].text).toContain('Tableau OAuth server mode');
    });
  });
});

async function getToolResult(
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getOAuthTokenTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({}, extra);
}
