import { z } from 'zod';

import { getEnv as getBaseEnv } from '../../testEnv';

const envSchema = z.object({
  TEST_USER: z.string(),
  TEST_PASSWORD: z.string(),
  TEST_SITE_NAME: z.string(),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  return getBaseEnv(envSchema);
}
