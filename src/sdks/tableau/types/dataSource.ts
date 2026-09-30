import { z } from 'zod';

import { projectSchema } from './project.js';
import { tagsSchema } from './tags.js';

// Tableau REST can deliver booleans as the strings "true"/"false"; `z.coerce.boolean()` would map
// "false" -> true (the `Boolean("false") === true` footgun) and mis-credit an uncertified clone as
// certified. Parse explicitly instead.
const tableauBoolean = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().toLowerCase() === 'true' : value === true),
  z.boolean(),
);

export const dataSourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  contentUrl: z.string().optional(),
  description: z.string().optional(),
  // `createdAt` and `isCertified` are returned by the Query Data Sources REST endpoint but were
  // historically not parsed here. The Admin Insights resolver uses them to disambiguate duplicate
  // datasources on sites with cloned Admin Insights content (W-24106279): the system-provisioned
  // datasource is certified and older than any user clone.
  createdAt: z.string().optional(),
  isCertified: tableauBoolean.optional(),
  project: projectSchema,
  owner: z
    .object({
      id: z.string(),
    })
    .optional(),
  tags: tagsSchema,
});

export type DataSource = z.infer<typeof dataSourceSchema>;
