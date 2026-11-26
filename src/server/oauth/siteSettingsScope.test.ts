import { isSiteSettingsScopeRequired } from './siteSettingsScope.js';

describe('isSiteSettingsScopeRequired', () => {
  const config = (
    overrides: Partial<{
      enforceScopes: boolean;
      advertiseApiScopes: boolean;
      enableMcpSiteSettings: boolean;
    }> = {},
  ): never => {
    const { enableMcpSiteSettings = true, ...oauth } = overrides;
    return {
      enableMcpSiteSettings,
      oauth: {
        enforceScopes: true,
        advertiseApiScopes: true,
        ...oauth,
      },
    } as never;
  };

  it('is required when scopes are enforced and advertised and site settings are on', () => {
    expect(isSiteSettingsScopeRequired(config())).toBe(true);
  });

  it.each([
    ['scopes are not enforced', { enforceScopes: false }],
    ['API scopes are not advertised', { advertiseApiScopes: false }],
    ['site settings are off', { enableMcpSiteSettings: false }],
  ])('is not required when %s', (_label, overrides) => {
    expect(isSiteSettingsScopeRequired(config(overrides))).toBe(false);
  });
});
