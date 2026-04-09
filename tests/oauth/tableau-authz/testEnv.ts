import dotenv from 'dotenv';
import { z } from 'zod';
import { fromError } from 'zod-validation-error/v3';

const envSchema = z.object({
  TEST_USER: z.string(),
  TEST_PASSWORD: z.string(),
  TEST_SITE_NAME: z.string(),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  dotenv.config();
  dotenv.config({ path: 'tests/oauth/tableau-authz/.env.oauth', override: true });

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    throw new Error(
      fromError(result.error, { prefix: 'Invalid environment variables' }).toString(),
    );
  }

  return result.data;
}
