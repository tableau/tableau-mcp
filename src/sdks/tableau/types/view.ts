import { z } from 'zod';

export const viewSchema = z.object({
  id: z.string(),
  name: z.string(),
});
