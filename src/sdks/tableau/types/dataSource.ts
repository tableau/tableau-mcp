import { z } from 'zod';

import { projectSchema } from './project.js';
import { tagsSchema } from './tags.js';

export const dataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  project: projectSchema,
  tags: tagsSchema,
});

export type DataSource = z.infer<typeof dataSourceSchema>;
