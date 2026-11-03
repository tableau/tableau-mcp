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

  it('ships with the enforce-strict-scope-match flag on', () => {
    // Either input alone turns strict off, so shipping the flag off would make subset the default.
    expect(features['enforce-strict-scope-match']).toBe(true);
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
      oauth: { enforceScopes: true, advertiseApiScopes: true, strictScopeMatch: true, ...oauth },
    } as never;
  };

  // The flag is off by default here, so strict is off and matching is subset.
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
  });

  it('is required when scopes are enforced and advertised, site settings are on, and strict is off', async () => {
    await expect(isSiteSettingsScopeRequired(config())).resolves.toBe(true);
  });

  it('is required when the env var alone turns strict off', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);

    await expect(isSiteSettingsScopeRequired(config({ strictScopeMatch: false }))).resolves.toBe(
      true,
    );
  });

  it.each([
    ['scopes are not enforced', { enforceScopes: false }],
    ['API scopes are not advertised', { advertiseApiScopes: false }],
    ['site settings are off', { enableMcpSiteSettings: false }],
  ])('is not required when %s', async (_label, overrides) => {
    await expect(isSiteSettingsScopeRequired(config(overrides))).resolves.toBe(false);
  });

  it('is not required when strict is on (env var and feature flag both on)', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);

    await expect(isSiteSettingsScopeRequired(config())).resolves.toBe(false);
  });
});
