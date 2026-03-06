import { z } from 'zod';

// Auth info resolved after signing in to Tableau Server (PAT, direct-trust, UAT).
// Not applicable for OAuth, where identity is already available in tableauAuthInfo.
export const tableauServiceAuthInfoSchema = z.object({
  userId: z.string(),
  siteLuid: z.string(),
});

export type TableauServiceAuthInfo = z.infer<typeof tableauServiceAuthInfoSchema>;
