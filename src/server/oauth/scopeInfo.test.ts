import express from 'express';

import * as configModule from '../../config.js';
import {
  closeLoopbackServer,
  default as request,
  startLoopbackServer,
} from '../../testLoopbackRequest.js';
import { scopeInfo } from './scopeInfo.js';
import { getSupportedApiScopes, getSupportedMcpScopes } from './scopes.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../config.js', () => ({
  getConfig: vi.fn(),
}));

vi.mock('../../getTableauServerInfo.js', () => ({
  getTableauServerInfo: vi.fn().mockResolvedValue({
    productVersion: { value: '2026.3.0', build: '' },
  }),
}));

vi.mock('../../features/init.js', () => ({
  getFeatureGate: () => ({
    isFeatureEnabled: mocks.mockIsFeatureEnabled,
  }),
}));

const mockGetConfig = vi.mocked(configModule.getConfig);
const slackClientId = 'https://mcp.slack.com/connector';

function mockOAuthConfig({
  enforceScopes = true,
  advertiseApiScopes = true,
}: { enforceScopes?: boolean; advertiseApiScopes?: boolean } = {}): void {
  mockGetConfig.mockReturnValue({
    adminToolsEnabled: false,
    oauth: { enforceScopes, advertiseApiScopes },
  } as any);
}

describe('/scopeInfo', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.mockIsFeatureEnabled.mockImplementation(
      async (featureName: string) => featureName === 'mcp-wildcard-scope',
    );
    await startLoopbackServer();
    app = express();
    scopeInfo(app);
  });

  afterEach(closeLoopbackServer);

  it('lists the explicit MCP scopes and the required and optional API scopes', async () => {
    mockOAuthConfig();

    const response = await request(app).get('/scopeInfo');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      mcpScopes: await getSupportedMcpScopes(),
      requiredApiScopes: await getSupportedApiScopes(undefined, { includeOptionalScopes: false }),
      optionalApiScopes: ['tableau:permissions:read'],
    });
    expect(response.body.mcpScopes).not.toContain('tableau:mcp:*');
  });

  it('lists the scopes supported for the client_id query parameter', async () => {
    mockOAuthConfig();

    const response = await request(app).get('/scopeInfo').query({ client_id: slackClientId });

    expect(response.body.mcpScopes).toEqual(await getSupportedMcpScopes(slackClientId));
    expect(response.body.mcpScopes).not.toEqual(await getSupportedMcpScopes());
  });

  it('lists no API scopes when API scopes are not advertised', async () => {
    mockOAuthConfig({ advertiseApiScopes: false });

    const response = await request(app).get('/scopeInfo');

    expect(response.body.mcpScopes).toEqual(await getSupportedMcpScopes());
    expect(response.body.requiredApiScopes).toEqual([]);
    expect(response.body.optionalApiScopes).toEqual([]);
  });

  it('lists no scopes when scopes are not enforced', async () => {
    mockOAuthConfig({ enforceScopes: false });

    const response = await request(app).get('/scopeInfo');

    expect(response.body).toEqual({ mcpScopes: [], requiredApiScopes: [], optionalApiScopes: [] });
  });
});
