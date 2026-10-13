import dotenv from 'dotenv';

import { resetEnv as resetBaseEnv, setEnv as setBaseEnv } from '../../testEnv.js';

export function setEnv(): void {
  setBaseEnv();
  // The admin-tools flag half of the gate is forced on in testSetup.ts.
  process.env.ADMIN_TOOLS_ENABLED = 'true';
  dotenv.config({ path: 'tests/oauth/embedded-authz/.env.oauth', override: true });
}

export function resetEnv(): void {
  resetBaseEnv();
  dotenv.config({ path: 'tests/oauth/embedded-authz/.env.oauth.reset', override: true });
}
