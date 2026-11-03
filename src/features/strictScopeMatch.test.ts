import features from '../../features.json';
import { isSiteSettingsScopeRequired, isStrictScopeMatchEnabled } from './strictScopeMatch.js';

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
    [false, false, true],
    [false, true, false],
    [true, false, false],
    [true, true, false],
  ])(
    'DISABLE_STRICT_SCOPE_MATCH=%s, disable-strict-scope-match flag=%s → strict %s',
    async (env, flag, expected) => {
      mocks.mockIsFeatureEnabled.mockResolvedValue(flag);

      await expect(
        isStrictScopeMatchEnabled({ oauth: { disableStrictScopeMatch: env } } as never),
      ).resolves.toBe(expected);
    },
  );

  it('does not consult the feature gate when DISABLE_STRICT_SCOPE_MATCH is on (short-circuit)', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    await isStrictScopeMatchEnabled({ oauth: { disableStrictScopeMatch: true } } as never);

    expect(mocks.mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('ships with the disable-strict-scope-match flag off', () => {
    // Either input alone turns strict off, so shipping the flag on would make subset the default.
    expect(features['disable-strict-scope-match']).toBe(false);
  });
});

describe('isSiteSettingsScopeRequired', () => {
  const config = (
    overrides: Partial<{
      enforceScopes: boolean;
      advertiseApiScopes: boolean;
      disableStrictScopeMatch: boolean;
      enableMcpSiteSettings: boolean;
    }> = {},
  ): never => {
    const { enableMcpSiteSettings = true, ...oauth } = overrides;
    return {
      enableMcpSiteSettings,
      oauth: {
        enforceScopes: true,
        advertiseApiScopes: true,
        disableStrictScopeMatch: false,
        ...oauth,
      },
    } as never;
  };

  // The flag is on by default here, so strict is off and matching is subset.
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
  });

  it('is required when scopes are enforced and advertised, site settings are on, and strict is off', async () => {
    await expect(isSiteSettingsScopeRequired(config())).resolves.toBe(true);
  });

  it('is required when the env var alone turns strict off', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    await expect(
      isSiteSettingsScopeRequired(config({ disableStrictScopeMatch: true })),
    ).resolves.toBe(true);
  });

  it.each([
    ['scopes are not enforced', { enforceScopes: false }],
    ['API scopes are not advertised', { advertiseApiScopes: false }],
    ['site settings are off', { enableMcpSiteSettings: false }],
  ])('is not required when %s', async (_label, overrides) => {
    await expect(isSiteSettingsScopeRequired(config(overrides))).resolves.toBe(false);
  });

  it('is not required when strict is on (env var and feature flag both off)', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);

    await expect(isSiteSettingsScopeRequired(config())).resolves.toBe(false);
  });
});
