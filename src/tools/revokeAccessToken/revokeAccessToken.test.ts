import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import invariant from '../../utils/invariant.js';
import { Provider } from '../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getRevokeAccessTokenTool } from './revokeAccessToken.js';

const MOCK_ISSUER = 'https://sso.online.tableau.com';
const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.dGVzdC1wYXlsb2Fk.signature';
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
      expect(result.content[0].text).toContain('Bearer');
    });
  });

  describe('X-Tableau-Auth (embedded authZ / Tableau Server mode)', () => {
    // In embedded authZ mode, tableauAuthInfo.accessToken is a Tableau REST API session token
    // (workgroup session ID), NOT an OAuth JWT. Sending it to an OAuth revocation endpoint
    // would be semantically wrong and likely fail. This mode is not yet supported.
    it('should return an error and make no fetch call for X-Tableau-Auth', async () => {
      const extra = getMockRequestHandlerExtra();
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
      expect(mockFetch).not.toHaveBeenCalled();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Bearer');
    });

    it('should return an error even when accessToken is absent', async () => {
      const extra = getMockRequestHandlerExtra();
      extra.tableauAuthInfo = {
        type: 'X-Tableau-Auth',
        username: 'test-user',
        server: MOCK_SERVER,
        siteId: 'site-id',
        // accessToken intentionally omitted
      };
      const result = await getToolResult(extra);

      expect(result.isError).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
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
