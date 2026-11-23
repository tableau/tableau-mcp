import features from '../../features.json';
import { isMcpWildcardScopeEnabled } from './mcpWildcardScope.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('./init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled }),
}));

describe('isMcpWildcardScopeEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([true, false])('follows the mcp-wildcard-scope flag (%s)', async (flag) => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(flag);

    await expect(isMcpWildcardScopeEnabled()).resolves.toBe(flag);
    expect(mocks.mockIsFeatureEnabled).toHaveBeenCalledWith('mcp-wildcard-scope');
  });

  it('ships with the mcp-wildcard-scope flag off', () => {
    // Clients would request tableau:mcp:*, which an authorization server may not issue yet.
    expect(features['mcp-wildcard-scope']).toBe(false);
  });
});
