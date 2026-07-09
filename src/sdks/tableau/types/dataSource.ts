import { z } from 'zod';

import { projectSchema } from './project.js';
import { tagsSchema } from './tags.js';

export const dataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  // contentUrl is the URL-safe slug that is UNIQUE per site (case-sensitively).
  // Unlike name, it disambiguates same-named datasources — needed to map a Desktop
  // workbook's <repository-location id="..."> to exactly one published datasource.
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
