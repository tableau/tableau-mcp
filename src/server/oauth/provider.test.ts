import { generateKeyPairSync } from 'crypto';

import { getConfig } from '../../config.js';
import { stubDefaultEnvVars } from '../../testShared.js';
import {
  createOAuthProvider,
  EmbeddedOAuthProvider,
  ExternalOAuthProvider,
  TableauOAuthProvider,
} from './provider.js';

describe('createOAuthProvider', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    vi.stubEnv('OAUTH_ISSUER', 'https://idp.example.com');
    vi.stubEnv('OAUTH_EMBEDDED_AUTHZ_SERVER', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
  });

  it('returns the embedded provider when the embedded authorization server is enabled', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    vi.stubEnv('OAUTH_EMBEDDED_AUTHZ_SERVER', 'true');
    vi.stubEnv(
      'OAUTH_JWE_PRIVATE_KEY',
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    );

    expect(createOAuthProvider(getConfig())).toBeInstanceOf(EmbeddedOAuthProvider);
  });

  it('returns the Tableau provider when no external authorization server is configured', () => {
    expect(createOAuthProvider(getConfig())).toBeInstanceOf(TableauOAuthProvider);
  });

  it('returns the external provider when OAUTH_EXTERNAL_* is configured', () => {
    vi.stubEnv('AUTH', 'direct-trust');
    vi.stubEnv('JWT_SUB_CLAIM', '{OAUTH_USERNAME}');
    vi.stubEnv('CONNECTED_APP_CLIENT_ID', 'connected-app-client-id');
    vi.stubEnv('CONNECTED_APP_SECRET_ID', 'connected-app-secret-id');
    vi.stubEnv('CONNECTED_APP_SECRET_VALUE', 'connected-app-secret-value');
    vi.stubEnv('OAUTH_EXTERNAL_JWKS_URI', 'https://idp.example.com/keys');

    expect(createOAuthProvider(getConfig())).toBeInstanceOf(ExternalOAuthProvider);
  });
});
