import { z } from 'zod';

import { projectSchema } from './project.js';
import { tagsSchema } from './tags.js';

export const dataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  // The stable, URL-safe content path segment (e.g. "SuperstoreDatasource"). Needed to synthesize a
  // published-datasource (sqlproxy) reference in a data-app workbook; not returned by every endpoint.
  contentUrl: z.string().optional(),
  description: z.string().optional(),
  project: projectSchema,
  owner: z
    .object({
      id: z.string(),
    })
    .optional(),
  tags: tagsSchema,
});

export type DataSource = z.infer<typeof dataSourceSchema>;
