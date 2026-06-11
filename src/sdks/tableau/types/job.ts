import { z } from 'zod';

export const jobSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  jobType: z.string().optional(),
  priority: z.coerce.number().optional(),
  createdAt: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  progress: z.coerce.number().optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
});

export type Job = z.infer<typeof jobSchema>;
