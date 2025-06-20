import { z } from 'zod';

export const projectSchema = z.object({
  name: z.string(),
  id: z.string(),
});

export const createProjectRequestSchema = projectSchema.omit({ id: true });

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
