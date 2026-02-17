import dotenv from 'dotenv';

import { resetEnv as resetBaseEnv, setEnv as setBaseEnv } from '../../testEnv.js';

export function setEnv(): void {
  setBaseEnv();
  dotenv.config({ path: 'tests/oauth/embedded-authz/.env.oauth', override: true });
  process.env.OAUTH_CLIENT_ID_SECRET_PAIRS = 'test-client-id:test-client-secret';
}

export function resetEnv(): void {
  resetBaseEnv();
  dotenv.config({ path: 'tests/oauth/embedded-authz/.env.oauth.reset', override: true });
  delete process.env.OAUTH_CLIENT_ID_SECRET_PAIRS;
}
