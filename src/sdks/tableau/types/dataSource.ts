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
  // Query Data Source (single, by LUID) can return either a published or an embedded (workbook) data
  // source on WBDS-enabled servers. Embedded ones carry `parentType: "Workbook"` and NO `project`;
  // published ones carry a `project`. The classifier keys off those two facts (see
  // getDatasourceMetadata.resolveDatasourceType), so both fields are optional here.
  project: projectSchema.optional(),
  parentType: z.string().optional(),
  owner: z
    .object({
      id: z.string(),
    })
    .optional(),
  tags: tagsSchema,
});

export type DataSource = z.infer<typeof dataSourceSchema>;

// Query Data Sources (list) returns published data sources only, so `project` is always present.
// Used by the list endpoint to get a non-optional `project` without narrowing at call sites.
export const publishedDataSourceSchema = dataSourceSchema.extend({
  project: projectSchema,
});

export type PublishedDataSource = z.infer<typeof publishedDataSourceSchema>;
