import { Config } from '../config.js';
import { TableauAuthInfo } from '../server/oauth/schemas.js';
import { getAuthTypeForTelemetry } from './authType.js';

// The function only reads config.auth, so a minimal cast keeps these tests focused on the unit.
const configWithAuth = (auth: Config['auth']): Config => ({ auth }) as unknown as Config;

const xTableauAuthInfo: TableauAuthInfo = {
  type: 'X-Tableau-Auth',
  username: 'user@example.com',
  server: 'https://my-tableau.example.com',
  siteName: 'my-site',
};

const bearerAuthInfo: TableauAuthInfo = {
  type: 'Bearer',
  username: 'user@example.com',
  server: 'https://my-tableau.example.com',
  siteId: 'abc123',
  siteName: 'my-site',
  raw: 'fake-token',
};

const passthroughAuthInfo: TableauAuthInfo = {
  type: 'Passthrough',
  username: 'user@example.com',
  userId: 'uid-1',
  server: 'https://my-tableau.example.com',
  siteId: 'abc123',
  siteName: 'my-site',
  raw: 'fake-token',
};

describe('getAuthTypeForTelemetry', () => {
  it("returns 'unknown' for an unrecognized config.auth with no tableauAuthInfo", () => {
    // Server-level modes leave tableauAuthInfo undefined, so 'unknown' only comes from an
    // unrecognized config.auth. The AuthType union can't express that, so cast to hit the default.
    expect(getAuthTypeForTelemetry(configWithAuth('bogus' as Config['auth']), undefined)).toBe(
      'unknown',
    );
  });

  it("returns 'pat' for config.auth='pat' with no tableauAuthInfo (server-level per-request sign-in)", () => {
    expect(getAuthTypeForTelemetry(configWithAuth('pat'), undefined)).toBe('pat');
  });

  it("returns 'uat' for config.auth='uat' with no tableauAuthInfo", () => {
    expect(getAuthTypeForTelemetry(configWithAuth('uat'), undefined)).toBe('uat');
  });

  it("returns 'direct-trust' for config.auth='direct-trust' with no tableauAuthInfo", () => {
    expect(getAuthTypeForTelemetry(configWithAuth('direct-trust'), undefined)).toBe('direct-trust');
  });

  it("returns 'embedded-oauth' for config.auth='oauth' with no tableauAuthInfo", () => {
    expect(getAuthTypeForTelemetry(configWithAuth('oauth'), undefined)).toBe('embedded-oauth');
  });

  it("returns 'passthrough' for Passthrough auth", () => {
    expect(getAuthTypeForTelemetry(configWithAuth('pat'), passthroughAuthInfo)).toBe('passthrough');
  });

  it("returns 'tableau-oauth' for Bearer auth", () => {
    expect(getAuthTypeForTelemetry(configWithAuth('pat'), bearerAuthInfo)).toBe('tableau-oauth');
  });

  it("returns 'pat' for X-Tableau-Auth with config.auth='pat'", () => {
    expect(getAuthTypeForTelemetry(configWithAuth('pat'), xTableauAuthInfo)).toBe('pat');
  });

  it("returns 'uat' for X-Tableau-Auth with config.auth='uat'", () => {
    expect(getAuthTypeForTelemetry(configWithAuth('uat'), xTableauAuthInfo)).toBe('uat');
  });

  it("returns 'direct-trust' for X-Tableau-Auth with config.auth='direct-trust'", () => {
    expect(getAuthTypeForTelemetry(configWithAuth('direct-trust'), xTableauAuthInfo)).toBe(
      'direct-trust',
    );
  });

  it("returns 'embedded-oauth' for X-Tableau-Auth with config.auth='oauth'", () => {
    expect(getAuthTypeForTelemetry(configWithAuth('oauth'), xTableauAuthInfo)).toBe(
      'embedded-oauth',
    );
  });

  it('lets Bearer win regardless of config.auth (external Tableau authz server)', () => {
    expect(getAuthTypeForTelemetry(configWithAuth('oauth'), bearerAuthInfo)).toBe('tableau-oauth');
  });

  it('lets Passthrough win regardless of config.auth', () => {
    expect(getAuthTypeForTelemetry(configWithAuth('oauth'), passthroughAuthInfo)).toBe(
      'passthrough',
    );
  });
});
