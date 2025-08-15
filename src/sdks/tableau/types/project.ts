import { z } from 'zod';

export const projectSchema = z.object({
  name: z.string(),
  id: z.string(),
});
