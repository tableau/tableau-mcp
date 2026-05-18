import { z } from 'zod';

import { projectSchema } from './project.js';
import { tagsSchema } from './tags.js';

const downstreamWorkbookSchema = z.object({
  luid: z.string(),
  name: z.string(),
  ownedByCurrentUser: z.boolean(),
});

export const dataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  project: projectSchema,
  tags: tagsSchema,
  downstreamWorkbooks: z.array(downstreamWorkbookSchema).optional(),
  downstreamWorkbookCount: z.number().optional(),
});

export type DataSource = z.infer<typeof dataSourceSchema>;
