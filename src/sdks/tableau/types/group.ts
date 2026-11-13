import { z } from 'zod';

export const groupSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.object({ name: z.string() }).optional(),
});

export type Group = z.infer<typeof groupSchema>;
