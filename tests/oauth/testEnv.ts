import dotenv from 'dotenv';

import { resetEnv as resetBaseEnv, setEnv as setBaseEnv } from '../testEnv.js';

export function setEnv(): void {
  setBaseEnv();
  dotenv.config({ path: 'tests/oauth/.env.oauth', override: true });
}

export function resetEnv(): void {
  resetBaseEnv();
  dotenv.config({ path: 'tests/oauth/.env.oauth.reset', override: true });
}
