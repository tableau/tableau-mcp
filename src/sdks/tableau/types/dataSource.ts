import { z } from 'zod';

import { projectSchema } from './project.js';
import { tableauBooleanSchema } from './tableauBoolean.js';
import { tagsSchema } from './tags.js';

export const dataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  contentUrl: z.string().optional(),
  description: z.string().optional(),
  // `createdAt` and `isCertified` are returned by the Query Data Sources REST endpoint but were
  // historically not parsed here. The Admin Insights resolver uses them to disambiguate duplicate
  // datasources on sites with cloned Admin Insights content (W-24106279): the system-provisioned
  // datasource is certified and older than any user clone. `isCertified` uses `tableauBooleanSchema`
  // (mirroring `topLevelProject` in `project.ts`) rather than `z.coerce.boolean()` so a stringified
  // `"false"` cannot mis-credit a clone via the `Boolean("false") === true` footgun.
  createdAt: z.string().optional(),
  isCertified: tableauBooleanSchema.optional(),
  project: projectSchema,
  owner: z
    .object({
      id: z.string(),
    })
    .optional(),
  tags: tagsSchema,
});

export type DataSource = z.infer<typeof dataSourceSchema>;
