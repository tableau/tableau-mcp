import dotenv from 'dotenv';

import { resetEnv as resetBaseEnv, setEnv as setBaseEnv } from '../testEnv.js';

export function setEnv(): void {
  setBaseEnv();
  dotenv.config({ path: 'tests/oauth/.env.oauth', override: true });
  process.env.OAUTH_ISSUER = process.env.OAUTH_ISSUER ?? 'http://127.0.0.1:3927';
  process.env.OAUTH_JWE_PRIVATE_KEY_PATH =
    process.env.OAUTH_JWE_PRIVATE_KEY_PATH ?? 'tests/oauth/fixtures/jwe-private-key.key';
  process.env.TABLEAU_MCP_TEST = process.env.TABLEAU_MCP_TEST ?? 'true';
  process.env.OAUTH_CLIENT_ID_SECRET_PAIRS = 'test-client-id:test-client-secret';
}

export function resetEnv(): void {
  resetBaseEnv();
  dotenv.config({ path: 'tests/oauth/.env.oauth.reset', override: true });
  delete process.env.OAUTH_CLIENT_ID_SECRET_PAIRS;
}
