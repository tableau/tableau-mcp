import { z } from 'zod';

export const siteSchema = z.object({
  id: z.string(),
  name: z.string(),
});
