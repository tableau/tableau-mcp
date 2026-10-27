import dotenv from 'dotenv';

import { resetEnv as resetBaseEnv, setEnv as setBaseEnv } from '../../testEnv.js';

export function setEnv(): void {
  setBaseEnv();
  // The admin-tools flag half of the gate is forced on in testSetup.ts.
  process.env.ADMIN_TOOLS_ENABLED = 'true';
  dotenv.config({ path: 'tests/oauth/embedded-authz/.env.oauth', override: true });
  // The dotenv files above override test.env; keep telemetry off regardless of their contents.
  process.env.PRODUCT_TELEMETRY_ENABLED = 'false';
}

export function resetEnv(): void {
  resetBaseEnv();
  dotenv.config({ path: 'tests/oauth/embedded-authz/.env.oauth.reset', override: true });
  process.env.PRODUCT_TELEMETRY_ENABLED = 'false';
}
