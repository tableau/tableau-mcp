import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import invariant from '../../utils/invariant.js';
import { Provider } from '../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRevokeAccessTokenTool } from './revokeAccessToken.js';

const MOCK_ISSUER = 'https://sso.online.tableau.com';
const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.dGVzdC1wYXlsb2Fk.signature';
const MOCK_JWE_TOKEN = 'eyJhbGciOiJSU0EtT0FFUC0yNTYifQ.encrypted-key.iv.ciphertext.tag';
const MOCK_SERVER = 'https://my-tableau-server.com';

describe('revokeAccessTokenTool', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should create a tool instance with correct properties', async () => {
    const tool = getRevokeAccessTokenTool(new Server());
    const annotations = await Provider.from(tool.annotations);
    expect(tool.name).toBe('revoke-access-token');
    expect(tool.paramsSchema).toEqual({});
    expect(annotations?.readOnlyHint).toBe(false);
    expect(annotations?.destructiveHint).toBe(true);
    expect(annotations?.idempotentHint).toBe(true);
    expect(annotations?.openWorldHint).toBe(false);
  });

  describe('disabled property', () => {
    let savedEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      savedEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = savedEnv;
    });

    it('should be disabled when AUTH is not oauth (default PAT mode)', () => {
      // Default test env uses PAT auth, not oauth
      delete process.env.OAUTH_ISSUER;
      const tool = getRevokeAccessTokenTool(new Server());
      expect(tool.disabled).toBe(true);
    });

    it('should be enabled when AUTH=oauth', () => {
      // Use OAUTH_EMBEDDED_AUTHZ_SERVER=false to avoid the JWE private key requirement
      process.env.AUTH = 'oauth';
      process.env.OAUTH_ISSUER = MOCK_ISSUER;
      process.env.OAUTH_EMBEDDED_AUTHZ_SERVER = 'false';
      const tool = getRevokeAccessTokenTool(new Server());
      expect(tool.disabled).toBe(false);
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
      };
      return extra;
    }

    it('should POST the raw JWT to the issuer revocation endpoint', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
      await getToolResult(makeBearerExtra());

      expect(mockFetch).toHaveBeenCalledWith(
        `${MOCK_ISSUER}/oauth2/revoke`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: MOCK_TOKEN }),
        }),
      );
    });

    it('should return a success result on HTTP 200', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
      const result = await getToolResult(makeBearerExtra());

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toContain('submitted for revocation');
    });

    it('should return an error result when the revocation endpoint returns non-200', async () => {
      mockFetch.mockResolvedValue(new Response('unauthorized', { status: 401 }));
      const result = await getToolResult(makeBearerExtra());

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('401');
    });

    it('should return an error result on network failure', async () => {
      mockFetch.mockRejectedValue(new Error('fetch failed: connection refused'));
      const result = await getToolResult(makeBearerExtra());

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('connection refused');
    });

    it('should not expose the raw token in the success response', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
      const result = await getToolResult(makeBearerExtra());

      const fullText = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
      expect(fullText).not.toContain(MOCK_TOKEN);
      expect(fullText).not.toContain('eyJ'); // no JWT fragment in output
    });
  });

  describe('X-Tableau-Auth (embedded authZ mode)', () => {
    function makeEmbeddedExtra(
      rawMcpToken?: string,
    ): ReturnType<typeof getMockRequestHandlerExtra> & { authInfo?: AuthInfo } {
      const extra = getMockRequestHandlerExtra() as ReturnType<
        typeof getMockRequestHandlerExtra
      > & { authInfo?: AuthInfo };
      extra.config.oauth.issuer = MOCK_ISSUER;
      extra.tableauAuthInfo = {
        type: 'X-Tableau-Auth',
        username: 'test-user',
        server: MOCK_SERVER,
        siteId: 'site-id',
        accessToken: 'tableau-access-token',
        refreshToken: 'tableau-refresh-token',
      };
      if (rawMcpToken !== undefined) {
        extra.authInfo = {
          token: rawMcpToken,
          clientId: 'test-client',
          scopes: [],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        };
      }
      return extra;
    }

    it('should POST the raw MCP JWE to the local revoke endpoint with token_type_hint', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
      const extra = makeEmbeddedExtra(MOCK_JWE_TOKEN);
      await getToolResult(extra);

      expect(mockFetch).toHaveBeenCalledWith(
        `${MOCK_ISSUER}/oauth2/revoke`,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: MOCK_JWE_TOKEN, token_type_hint: 'access_token' }),
        }),
      );
    });

    it('should return success on HTTP 200', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
      const result = await getToolResult(makeEmbeddedExtra(MOCK_JWE_TOKEN));

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toContain('submitted for revocation');
    });

    it('should return an error when authInfo.token is not available', async () => {
      const extra = makeEmbeddedExtra(undefined);
      const result = await getToolResult(extra);

      expect(result.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('raw MCP access token could not be determined');
    });

    it('should return an error result when the revocation endpoint returns non-200', async () => {
      mockFetch.mockResolvedValue(new Response('error', { status: 500 }));
      const result = await getToolResult(makeEmbeddedExtra(MOCK_JWE_TOKEN));

      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('500');
    });

    it('should not expose the raw JWE token in the success response', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
      const result = await getToolResult(makeEmbeddedExtra(MOCK_JWE_TOKEN));

      const fullText = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
      expect(fullText).not.toContain(MOCK_JWE_TOKEN);
    });
  });

  describe('Missing auth info (non-OAuth modes)', () => {
    it('should return an error and make no fetch call when tableauAuthInfo is undefined', async () => {
      const extra = getMockRequestHandlerExtra();
      extra.tableauAuthInfo = undefined;
      const result = await getToolResult(extra);

      expect(result.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('OAuth authentication');
    });
  });

  describe('Passthrough auth (not supported)', () => {
    it('should return an error and make no fetch call for Passthrough auth', async () => {
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
      expect(mockFetch).not.toHaveBeenCalled();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Passthrough');
    });
  });
});

async function getToolResult(
  extra: ReturnType<typeof getMockRequestHandlerExtra>,
): Promise<CallToolResult> {
  const tool = getRevokeAccessTokenTool(new Server());
  const callback = await Provider.from(tool.callback);
  return await callback({}, extra);
}
