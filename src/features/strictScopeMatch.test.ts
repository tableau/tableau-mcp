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

describe('isSiteSettingsScopeRequired', () => {
  const config = (
    overrides: Partial<{
      enforceScopes: boolean;
      advertiseApiScopes: boolean;
      strictScopeMatch: boolean;
      enableMcpSiteSettings: boolean;
    }> = {},
  ): never => {
    const { enableMcpSiteSettings = true, ...oauth } = overrides;
    return {
      enableMcpSiteSettings,
      oauth: { enforceScopes: true, advertiseApiScopes: true, strictScopeMatch: false, ...oauth },
    } as never;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
  });

  it('is required when scopes are enforced and advertised, site settings are on, and strict is off', async () => {
    await expect(isSiteSettingsScopeRequired(config())).resolves.toBe(true);
  });

  it.each([
    ['scopes are not enforced', { enforceScopes: false }],
    ['API scopes are not advertised', { advertiseApiScopes: false }],
    ['strict is on via the env var', { strictScopeMatch: true }],
    ['site settings are off', { enableMcpSiteSettings: false }],
  ])('is not required when %s', async (_label, overrides) => {
    await expect(isSiteSettingsScopeRequired(config(overrides))).resolves.toBe(false);
  });

  it('is not required when strict is on via the feature flag', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);

    await expect(isSiteSettingsScopeRequired(config())).resolves.toBe(false);
  });
});
