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

  describe('disabled property', () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      savedEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = savedEnv;
    });

    it('should be disabled when AUTH is not oauth (default PAT mode)', async () => {
      // Default test env uses PAT auth, not oauth
      delete process.env.OAUTH_ISSUER;
      const tool = getOAuthTokenTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(true);
    });

    it('should be enabled when AUTH=oauth', async () => {
      // Use OAUTH_EMBEDDED_AUTHZ_SERVER=false to avoid the JWE private key requirement
      process.env.AUTH = 'oauth';
      process.env.OAUTH_ISSUER = MOCK_ISSUER;
      process.env.OAUTH_EMBEDDED_AUTHZ_SERVER = 'false';
      const tool = getOAuthTokenTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(false);
    });
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

  describe('X-Tableau-Auth (embedded authZ mode - not supported)', () => {
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
      expect(result.content[0].text).toContain('X-Tableau-Auth');
    });
  });

  describe('Passthrough auth (not supported)', () => {
    it('should return an error for Passthrough auth', async () => {
      const extra = getMockRequestHandlerExtra();
      extra.tableauAuthInfo = {
        type: 'Passthrough',
        username: 'test-user',
        userId: 'user-id',
        server: MOCK_SERVER,
        siteId: 'site-id',
        raw: 'x-tableau-auth-session-token',
      };
      const result = await getToolResult(extra);

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Bearer authentication');
      expect(result.content[0].text).toContain('Passthrough');
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
