import { describe, expect, it } from 'vitest';

import { TableauAuthInfo } from './schemas.js';
import {
  assertSignedInSiteMatchesToken,
  checkEmbeddedTokenBinding,
  getSessionBinding,
  serversMatch,
  siteMatchesConfig,
} from './siteBinding.js';

type BindingConfig = Parameters<typeof checkEmbeddedTokenBinding>[0];

function makeConfig(overrides: {
  auth: BindingConfig['auth'];
  lockSite: boolean;
  server?: string;
  siteName?: string;
}): BindingConfig {
  return {
    auth: overrides.auth,
    server: overrides.server ?? 'https://10ay.online.tableau.com',
    siteName: overrides.siteName ?? 'site-b',
    oauth: { lockSite: overrides.lockSite },
  } as BindingConfig;
}

const SERVER = 'https://10ay.online.tableau.com';

describe('serversMatch', () => {
  it('compares hostnames only, so scheme and port in SERVER do not reject valid tokens', () => {
    expect(serversMatch('http://10ay.online.tableau.com:8080', `${SERVER}/`)).toBe(true);
  });

  it('ignores trailing slashes, paths, and host case', () => {
    expect(serversMatch(SERVER, `${SERVER}/`)).toBe(true);
    expect(serversMatch(SERVER, 'https://10AY.online.tableau.com/some/path')).toBe(true);
  });

  it('rejects different hosts and unparsable values', () => {
    expect(serversMatch(SERVER, 'https://10az.online.tableau.com')).toBe(false);
    expect(serversMatch(SERVER, 'not a url')).toBe(false);
  });
});

describe('siteMatchesConfig', () => {
  it('matches on contentUrl, display name, or the Default site', () => {
    expect(siteMatchesConfig({ configSiteName: 'a', siteContentUrl: 'a' })).toBe(true);
    expect(siteMatchesConfig({ configSiteName: 'a', siteName: 'a' })).toBe(true);
    expect(siteMatchesConfig({ configSiteName: '', siteName: 'Default' })).toBe(true);
    expect(siteMatchesConfig({ configSiteName: 'a', siteContentUrl: 'b', siteName: 'b' })).toBe(
      false,
    );
  });
});

describe('checkEmbeddedTokenBinding', () => {
  describe.each([true, false])('OAUTH_LOCK_SITE=%s', (lockSite) => {
    it.each(['uat', 'direct-trust', 'pat'] as const)(
      '%s: rejects a bearer minted for a different site',
      (auth) => {
        const error = checkEmbeddedTokenBinding(makeConfig({ auth, lockSite }), {
          tableauServer: SERVER,
          tableauSiteContentUrl: 'site-a',
        });
        expect(error).toMatch(/different Tableau site/);
      },
    );

    it.each(['uat', 'direct-trust', 'pat'] as const)(
      '%s: fails closed when the bearer carries no site claim',
      (auth) => {
        const error = checkEmbeddedTokenBinding(makeConfig({ auth, lockSite }), {
          tableauServer: SERVER,
          tableauSiteContentUrl: undefined,
        });
        expect(error).toMatch(/not bound/);
      },
    );

    it.each(['uat', 'direct-trust', 'pat'] as const)('%s: accepts the matching site', (auth) => {
      expect(
        checkEmbeddedTokenBinding(makeConfig({ auth, lockSite }), {
          tableauServer: `${SERVER}/`,
          tableauSiteContentUrl: 'site-b',
        }),
      ).toBeUndefined();
    });

    it('rejects a targetUrl/server mismatch in every mode', () => {
      for (const auth of ['uat', 'oauth'] as const) {
        const error = checkEmbeddedTokenBinding(
          makeConfig({ auth, lockSite }),
          { tableauServer: 'https://10az.online.tableau.com', tableauSiteContentUrl: 'site-b' },
          { name: 'site-b', contentUrl: 'site-b' },
        );
        expect(error).toMatch(/different Tableau server/);
      }
    });

    it('accepts the Default site when SITE_NAME is empty', () => {
      expect(
        checkEmbeddedTokenBinding(makeConfig({ auth: 'uat', lockSite, siteName: '' }), {
          tableauServer: SERVER,
          tableauSiteContentUrl: '',
        }),
      ).toBeUndefined();
    });
  });

  describe('oauth mode', () => {
    it('with OAUTH_LOCK_SITE=true rejects a live session on another site', () => {
      const error = checkEmbeddedTokenBinding(
        makeConfig({ auth: 'oauth', lockSite: true }),
        { tableauServer: SERVER, tableauSiteContentUrl: 'site-a' },
        { name: 'site-a', contentUrl: 'site-a' },
      );
      expect(error).toMatch(/different Tableau site/);
    });

    it('with OAUTH_LOCK_SITE=true accepts the configured site', () => {
      expect(
        checkEmbeddedTokenBinding(
          makeConfig({ auth: 'oauth', lockSite: true }),
          { tableauServer: SERVER, tableauSiteContentUrl: 'site-b' },
          { name: 'site-b', contentUrl: 'site-b' },
        ),
      ).toBeUndefined();
    });

    it('with OAUTH_LOCK_SITE=true accepts SITE_NAME set to the display name', () => {
      expect(
        checkEmbeddedTokenBinding(
          makeConfig({ auth: 'oauth', lockSite: true, siteName: 'Marketing' }),
          { tableauServer: SERVER, tableauSiteContentUrl: 'mktg' },
          { name: 'Marketing', contentUrl: 'mktg' },
        ),
      ).toBeUndefined();
    });

    it('with OAUTH_LOCK_SITE=false lets the user choose the site', () => {
      expect(
        checkEmbeddedTokenBinding(
          makeConfig({ auth: 'oauth', lockSite: false }),
          { tableauServer: SERVER, tableauSiteContentUrl: 'site-a' },
          { name: 'site-a', contentUrl: 'site-a' },
        ),
      ).toBeUndefined();
    });
  });
});

describe('assertSignedInSiteMatchesToken', () => {
  const xTableauAuth = (siteId?: string): TableauAuthInfo => ({
    type: 'X-Tableau-Auth',
    username: 'viewer-a@example.com',
    server: SERVER,
    siteName: 'site-b',
    ...(siteId ? { siteId } : {}),
  });

  it('throws when the UAT exchange lands on a different site than the outer token (Viewer-A/Admin-B)', () => {
    expect(() =>
      assertSignedInSiteMatchesToken({
        signedInSiteId: 'luid-site-b',
        tableauAuthInfo: xTableauAuth('luid-site-a'),
      }),
    ).toThrow(/Site binding violation/);
  });

  it('passes when the signed-in site equals the outer token site', () => {
    expect(() =>
      assertSignedInSiteMatchesToken({
        signedInSiteId: 'luid-site-b',
        tableauAuthInfo: xTableauAuth('luid-site-b'),
      }),
    ).not.toThrow();
  });

  it('is a no-op when there is no outer token (stdio / static credentials)', () => {
    expect(() =>
      assertSignedInSiteMatchesToken({ signedInSiteId: 'luid-site-b', tableauAuthInfo: undefined }),
    ).not.toThrow();
  });
});

describe('getSessionBinding', () => {
  const base: TableauAuthInfo = {
    type: 'X-Tableau-Auth',
    username: 'alice@example.com',
    server: SERVER,
    siteName: 'site-b',
    siteId: 'luid-b',
    userId: 'u1',
  };

  it('is stable for the same principal', () => {
    expect(getSessionBinding({ ...base })).toBe(getSessionBinding({ ...base }));
  });

  it.each([
    ['username', { username: 'mallory@example.com' }],
    ['server', { server: 'https://10az.online.tableau.com' }],
    ['siteName', { siteName: 'site-a' }],
    ['siteId', { siteId: 'luid-a' }],
    ['userId', { userId: 'u2' }],
  ])('changes when %s changes', (_field, override) => {
    expect(getSessionBinding({ ...base, ...override } as TableauAuthInfo)).not.toBe(
      getSessionBinding(base),
    );
  });

  it('is empty without auth info', () => {
    expect(getSessionBinding(undefined)).toBe('');
  });
});
