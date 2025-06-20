import { z } from 'zod';

import { projectSchema } from './project.js';

export const dataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  project: projectSchema,
});

export type DataSource = z.infer<typeof dataSourceSchema>;
