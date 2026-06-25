import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { decodeJwt } from 'jose';

import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getEmbedTokenTool } from './getEmbedToken.js';
import { EMBED_SCOPE } from './resolveEmbedToken.js';

const MOCK_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.dGVzdC1wYXlsb2Fk.signature';

type Extra = ReturnType<typeof getMockRequestHandlerExtra>;

function setDirectTrust(extra: Extra): void {
  extra.config.auth = 'direct-trust';
  extra.config.connectedAppClientId = 'client-id-123';
  extra.config.connectedAppSecretId = 'secret-id-456';
  extra.config.connectedAppSecretValue = 'super-secret-value';
  extra.config.jwtUsername = 'embed-user@example.com';
  extra.tableauAuthInfo = undefined;
}

function setNoMaterial(extra: Extra): void {
  extra.config.auth = 'pat';
  extra.config.connectedAppClientId = '';
  extra.config.connectedAppSecretId = '';
  extra.config.connectedAppSecretValue = '';
  extra.config.jwtUsername = '';
  extra.tableauAuthInfo = undefined;
}

describe('getEmbedTokenTool', () => {
  it('should create a tool instance with correct properties', async () => {
    const tool = getEmbedTokenTool(new WebMcpServer());
    const annotations = await Provider.from(tool.annotations);
    expect(tool.name).toBe('get-embed-token');
    expect(tool.paramsSchema).toEqual({});
    expect(annotations?.readOnlyHint).toBe(true);
    expect(annotations?.openWorldHint).toBe(false);
  });

  it('should set visibility to app-only', () => {
    const tool = getEmbedTokenTool(new WebMcpServer());
    expect(tool.meta?.ui?.visibility).toEqual(['app']);
  });

  it('passes through a Bearer token from tableauAuthInfo', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.tableauAuthInfo = {
      type: 'Bearer',
      raw: MOCK_TOKEN,
      username: 'test@example.com',
      server: 'https://example.com',
      siteId: 'test-site-id',
      siteName: 'test-site',
      clientId: 'test-client-id',
    };

    const result = await getToolResult(extra);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.token).toBe(MOCK_TOKEN);
    expect(response.tokenType).toBe('Bearer');
  });

  it('signs a direct-trust embed JWT carrying the embed scope', async () => {
    const extra = getMockRequestHandlerExtra();
    setDirectTrust(extra);

    const result = await getToolResult(extra);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    expect(response.tokenType).toBe('Bearer');
    const payload = decodeJwt(response.token);
    expect(payload.scp).toEqual([EMBED_SCOPE]);
    expect(payload.sub).toBe('embed-user@example.com');
  });

  it('returns a not-available error when no token can be produced', async () => {
    const extra = getMockRequestHandlerExtra();
    setNoMaterial(extra);

    const result = await getToolResult(extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No embed token is available');
  });
});

async function getToolResult(extra: Extra): Promise<CallToolResult> {
  const tool = getEmbedTokenTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({}, extra);
}
