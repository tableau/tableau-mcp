import features from '../../features.json';
import { isStrictScopeMatchEnabled } from './strictScopeMatch.js';

const mocks = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('./init.js', () => ({
  getFeatureGate: () => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled }),
}));

describe('isStrictScopeMatchEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [true, true, true],
    [true, false, true],
    [false, true, true],
    [false, false, false],
  ])(
    'ENFORCE_STRICT_SCOPE_MATCH=%s, enforce-strict-scope-match flag=%s → %s',
    async (env, flag, expected) => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(flag);

      await expect(
        isStrictScopeMatchEnabled({ oauth: { strictScopeMatch: env } } as never),
      ).resolves.toBe(expected);
    },
  );

  it('does not consult the feature gate when ENFORCE_STRICT_SCOPE_MATCH is on (short-circuit)', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    await isStrictScopeMatchEnabled({ oauth: { strictScopeMatch: true } } as never);

    expect(mocks.mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('ships with the enforce-strict-scope-match flag off', () => {
    // Either input alone turns strict on, so shipping the flag on would make strict the default.
    expect(features['enforce-strict-scope-match']).toBe(false);
  });
});
