import { z } from 'zod';

import { flowParamsSchema } from '../types/flowParameter.js';
import { ownerSchema } from '../types/owner.js';
import { projectSchema } from '../types/project.js';
import { tagsSchema } from '../types/tag.js';

export const flowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  webpageUrl: z.string(),
  fileType: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  project: projectSchema,
  owner: ownerSchema,
  tags: tagsSchema.optional(),
  parameters: flowParamsSchema.optional(),
});

export type Flow = z.infer<typeof flowSchema>;
