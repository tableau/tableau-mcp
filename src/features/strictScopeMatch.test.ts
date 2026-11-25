import { isSiteSettingsScopeRequired, isStrictScopeMatchEnabled } from './strictScopeMatch.js';

describe('isStrictScopeMatchEnabled', () => {
  it.each([
    [false, true],
    [true, false],
  ])('DISABLE_STRICT_SCOPE_MATCH=%s → strict %s', async (disabled, expected) => {
    await expect(
      isStrictScopeMatchEnabled({ oauth: { disableStrictScopeMatch: disabled } } as never),
    ).resolves.toBe(expected);
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
        disableStrictScopeMatch: true,
        ...oauth,
      },
    } as never;
  };

  it('is required when scopes are enforced and advertised, site settings are on, and strict is off', async () => {
    await expect(isSiteSettingsScopeRequired(config())).resolves.toBe(true);
  });

  it.each([
    ['scopes are not enforced', { enforceScopes: false }],
    ['API scopes are not advertised', { advertiseApiScopes: false }],
    ['site settings are off', { enableMcpSiteSettings: false }],
  ])('is not required when %s', async (_label, overrides) => {
    await expect(isSiteSettingsScopeRequired(config(overrides))).resolves.toBe(false);
  });

  it('is not required when strict is on', async () => {
    await expect(
      isSiteSettingsScopeRequired(config({ disableStrictScopeMatch: false })),
    ).resolves.toBe(false);
  });
});
