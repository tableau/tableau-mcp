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
    [true, false, false],
    [false, true, false],
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

  it('does not consult the feature gate when ENFORCE_STRICT_SCOPE_MATCH is off (short-circuit)', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);

    await isStrictScopeMatchEnabled({ oauth: { strictScopeMatch: false } } as never);

    expect(mocks.mockIsFeatureEnabled).not.toHaveBeenCalled();
  });
});
