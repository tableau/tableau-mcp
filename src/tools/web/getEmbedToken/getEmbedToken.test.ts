import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { decodeJwt, exportPKCS8, generateKeyPair } from 'jose';

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

function setOAuth(extra: Extra): void {
  extra.config.auth = 'oauth';
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
  });

  it('signs a direct-trust embed JWT carrying the embed scope', async () => {
    const extra = getMockRequestHandlerExtra();
    setDirectTrust(extra);

    const result = await getToolResult(extra);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    const payload = decodeJwt(response.token);
    expect(payload.scp).toEqual([EMBED_SCOPE]);
    expect(payload.sub).toBe('embed-user@example.com');
  });

  it('returns a not-available error when no token can be produced (pat without Bearer)', async () => {
    const extra = getMockRequestHandlerExtra();
    setNoMaterial(extra);

    const result = await getToolResult(extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Failed to get an embed token');
  });

  it('returns a not-available error for oauth without Bearer token', async () => {
    const extra = getMockRequestHandlerExtra();
    setOAuth(extra);

    const result = await getToolResult(extra);

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Failed to get an embed token');
  });

  it('signs a uat embed JWT with the embed scope', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(privateKey);

    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'uat';
    extra.config.jwtUsername = 'embed-user@example.com';
    extra.config.uatTenantId = 'test-tenant-id';
    extra.config.uatIssuer = 'test-issuer';
    extra.config.uatUsernameClaimName = 'email';
    extra.config.uatPrivateKey = privateKeyPem;
    extra.config.uatKeyId = 'test-key-id';
    extra.tableauAuthInfo = undefined;

    const result = await getToolResult(extra);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    const payload = decodeJwt(response.token);
    expect(payload.scp).toEqual([EMBED_SCOPE]);
    expect(payload.email).toBe('embed-user@example.com');
    expect(payload.iss).toBe('test-issuer');
  });

  it('passes through Bearer token even when X-Tableau-Auth is present (Tableau-authz mode)', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'oauth';
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
  });

  it('signs a direct-trust JWT when X-Tableau-Auth authInfo is present (embedded-authz mode)', async () => {
    const extra = getMockRequestHandlerExtra();
    setDirectTrust(extra);
    extra.tableauAuthInfo = {
      type: 'X-Tableau-Auth',
      username: 'embed-user@example.com',
      server: 'https://example.com',
      siteName: 'site',
    };

    const result = await getToolResult(extra);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    const payload = decodeJwt(response.token);
    expect(payload.scp).toEqual([EMBED_SCOPE]);
    expect(payload.sub).toBe('embed-user@example.com');
  });

  it('applies {OAUTH_USERNAME} substitution end-to-end in direct-trust embed JWT', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.config.auth = 'direct-trust';
    extra.config.siteName = 'test-site';
    extra.config.jwtUsername = '{OAUTH_USERNAME}';
    extra.config.connectedAppClientId = 'client-id-123';
    extra.config.connectedAppSecretId = 'secret-id-456';
    extra.config.connectedAppSecretValue = 'super-secret-value';
    extra.config.jwtAdditionalPayload = '{"email":"{OAUTH_USERNAME}","role":"viewer"}';
    extra.tableauAuthInfo = {
      type: 'X-Tableau-Auth',
      username: 'oauth-user@example.com',
      server: 'https://example.com',
      siteName: 'test-site',
    };

    const result = await getToolResult(extra);

    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const response = JSON.parse(result.content[0].text);
    const payload = decodeJwt(response.token);
    // Verify the substitution happened in the subject claim
    expect(payload.sub).toBe('oauth-user@example.com');
    // Verify the substitution happened in additionalPayload
    expect(payload.email).toBe('oauth-user@example.com');
    expect(payload.role).toBe('viewer');
    // Verify embed scope is present
    expect(payload.scp).toEqual([EMBED_SCOPE]);
  });
});

async function getToolResult(extra: Extra): Promise<CallToolResult> {
  const tool = getEmbedTokenTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback({}, extra);
}
