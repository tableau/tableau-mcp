import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { Server } from '../../server.js';
import invariant from '../../utils/invariant.js';
import { Provider } from '../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getResetConsentTool } from './resetConsent.js';

const MOCK_ISSUER = 'https://sso.online.tableau.com';
const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.dGVzdC1wYXlsb2Fk.signature';
const MOCK_SERVER = 'https://my-tableau-server.com';

describe('resetConsentTool', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should create a tool instance with correct properties', async () => {
    const tool = getResetConsentTool(new Server());
    const annotations = await Provider.from(tool.annotations);
    expect(tool.name).toBe('reset-consent');
    expect(tool.paramsSchema).toEqual({});
    expect(annotations?.readOnlyHint).toBe(false);
    expect(annotations?.destructiveHint).toBe(false);
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

    it('should be disabled when AUTH is not oauth (default PAT mode)', async () => {
      delete process.env.OAUTH_ISSUER;
      const tool = getResetConsentTool(new Server());
      expect(await Provider.from(tool.disabled)).toBe(true);
    });

    it('should be enabled when AUTH=oauth', async () => {
      process.env.AUTH = 'oauth';
      process.env.OAUTH_ISSUER = MOCK_ISSUER;
      process.env.OAUTH_EMBEDDED_AUTHZ_SERVER = 'false';
      const tool = getResetConsentTool(new Server());
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
      };
      return extra;
    }

    it('should POST to the issuer resetConsent endpoint with Authorization Bearer header and no body', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
      await getToolResult(makeBearerExtra());

      expect(mockFetch).toHaveBeenCalledWith(
        `${MOCK_ISSUER}/oauth2/resetConsent`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_TOKEN}`,
          }),
        }),
      );
    });

    it('should not include a request body', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
      await getToolResult(makeBearerExtra());

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.body).toBeUndefined();
    });

    it('should return a success result on HTTP 200', async () => {
      mockFetch.mockResolvedValue(new Response('{}', { status: 200 }));
      const result = await getToolResult(makeBearerExtra());

      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('consent');
    });

    it('should return an error result when the endpoint returns non-200', async () => {
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
      expect(fullText).not.toContain('eyJ');
    });
  });

  describe('X-Tableau-Auth (embedded authZ mode -- not supported)', () => {
    it('should return an error and make no fetch call for X-Tableau-Auth', async () => {
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
      expect(mockFetch).not.toHaveBeenCalled();
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('embedded');
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
  const tool = getResetConsentTool(new Server());
  const callback = await Provider.from(tool.callback);
  return await callback({}, extra);
}
