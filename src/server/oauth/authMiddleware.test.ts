import { describe, expect, it, vi } from 'vitest';

import * as configModule from '../../config.js';
import {
  getRequiredApiScopesForRequest,
  getRequiredMcpScopesForRequest,
} from './authMiddleware.js';

vi.mock('../../config.js', () => ({
  getConfig: vi.fn(),
}));

const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test', version: '1.0' },
  },
};

const writeToolRequest = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/call',
  params: { name: 'create-knowledge-semantic-statements', arguments: {} },
};

describe('OAuth request scope resolution', () => {
  it('requires default scopes for initialize without advertised API scopes', async () => {
    vi.mocked(configModule.getConfig).mockReturnValue({
      adminToolsEnabled: false,
      oauth: { enforceScopes: true },
    } as any);

    const mcpScopes = await getRequiredMcpScopesForRequest(initializeRequest);

    expect(mcpScopes).toContain('tableau:mcp:knowledge:read');
    expect(mcpScopes).not.toContain('tableau:mcp:knowledge:write');
    await expect(getRequiredApiScopesForRequest(initializeRequest, false)).resolves.toEqual([]);
  });

  it('requires default API scopes for initialize when API scopes are advertised', async () => {
    vi.mocked(configModule.getConfig).mockReturnValue({
      adminToolsEnabled: false,
      oauth: { enforceScopes: true },
    } as any);

    const apiScopes = await getRequiredApiScopesForRequest(initializeRequest, true);

    expect(apiScopes).toContain('tableau:knowledge:read');
    expect(apiScopes).not.toContain('tableau:knowledge:write');
  });

  it('still requires both explicit write scopes for a Knowledge write tool', async () => {
    vi.mocked(configModule.getConfig).mockReturnValue({
      adminToolsEnabled: false,
      oauth: { enforceScopes: true },
    } as any);

    await expect(getRequiredMcpScopesForRequest(writeToolRequest)).resolves.toEqual([
      'tableau:mcp:knowledge:write',
    ]);
    await expect(getRequiredApiScopesForRequest(writeToolRequest, true)).resolves.toEqual([
      'tableau:knowledge:write',
    ]);
  });
});
