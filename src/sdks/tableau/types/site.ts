import { z } from 'zod';

export const siteSchema = z.object({
  id: z.string(),
  name: z.string(),
  contentUrl: z.string().optional(),
  // Missing on older REST API responses (e.g. the /sessions/current session shape) — absence
  // must mean "treat Personal Space as unavailable", not "assume it's on".
  personalSpaceEnabled: z.boolean().default(false),
});

export type Site = z.infer<typeof siteSchema>;
