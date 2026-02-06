import { z } from 'zod';

import { projectSchema } from './project.js';
import { tagsSchema } from './tags.js';
import { viewSchema } from './view.js';

export const workbookSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  webpageUrl: z.string().optional(),
  contentUrl: z.string(),
  project: projectSchema.optional(),
  showTabs: z.coerce.boolean(),
  defaultViewId: z.string().optional(),
  tags: tagsSchema,
  views: z.optional(
    z.object({
      view: z.array(viewSchema),
    }),
  ),
});

export type Workbook = z.infer<typeof workbookSchema>;
