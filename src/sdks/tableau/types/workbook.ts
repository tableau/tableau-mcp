import { z } from 'zod';

import { projectSchema } from './project.js';

export const workbookSchema = z.object({
  id: z.string(),
  name: z.string(),
  contentUrl: z.string(),
  project: projectSchema,
  showTabs: z.coerce.boolean(),
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
