import { z } from 'zod';

import { projectSchema } from './project.js';
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
  views: z.optional(
    z.object({
      view: z.array(viewSchema),
    }),
  ),
  connections: z.optional(
    z.object({
      connection: z.array(
        z.object({
          serverAddress: z.string(),
          connectionCredentials: z.object({
            name: z.string(),
            password: z.string(),
            embed: z.coerce.boolean(),
          }),
        }),
      ),
    }),
  ),
});

export type Workbook = z.infer<typeof workbookSchema>;
