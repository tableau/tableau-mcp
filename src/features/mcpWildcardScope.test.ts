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

  it('ships with the mcp-wildcard-scope flag on', () => {
    // Clients request tableau:mcp:*, so every authorization server must issue it before release.
    expect(features['mcp-wildcard-scope']).toBe(true);
  });
});
