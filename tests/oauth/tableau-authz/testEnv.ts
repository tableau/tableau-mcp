import dotenv from 'dotenv';
import { z } from 'zod';

const envSchema = z.object({
  TEST_USER: z.string().min(1, 'TEST_USER is required'),
  TEST_PASSWORD: z.string().min(1, 'TEST_PASSWORD is required'),
  TEST_SITE_NAME: z.string().min(1, 'TEST_SITE_NAME is required'),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  dotenv.config({ path: 'tests/oauth/tableau-authz/.env.oauth', override: true });

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const missing = Object.entries(errors)
      .map(([key, msgs]) => `  ${key}: ${msgs?.join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${missing}`);
  }

  return result.data;
}
