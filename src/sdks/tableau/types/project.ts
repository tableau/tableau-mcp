import { z } from 'zod';

export const projectSchema = z.object({
  name: z.string(),
  id: z.string(),
});

export type Project = z.infer<typeof projectSchema>;
