import { z } from 'zod';

import { lineageContentSchema, Owner } from './lineageContent.js';
import { projectSchema } from './project.js';
import { tagsSchema } from './tags.js';
import { viewSchema } from './view.js';

// REST returns owner as { id, name } where `name` is the login username; rename it to `username`
// to match the emitted Owner shape (`displayName` comes from the Metadata API). `name` is nullable.
const restOwnerSchema = z
  .object({ id: z.string(), name: z.string().nullish() })
  .transform(({ id, name }): Owner => (name ? { id, username: name } : { id }));

export const workbookSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  webpageUrl: z.string().optional(),
  contentUrl: z.string(),
  project: projectSchema.optional(),
  // The destination the server actually recorded: `type` is 'Project' or 'PersonalSpace'. Used to
  // confirm a personal-space publish truly landed there — a personal-space landing has no `project`
  // in the response at all, so the tool reads `location` to see where a Personal Space publish landed.
  location: z
    .object({
      id: z.string().optional(),
      type: z.string().optional(),
      name: z.string().optional(),
    })
    .passthrough()
    .optional(),
  owner: restOwnerSchema.optional(),
  showTabs: z.coerce.boolean(),
  defaultViewId: z.string().optional(),
  tags: tagsSchema,
  upstreamDatasources: z.array(lineageContentSchema).optional(),
  views: z.optional(
    z.object({
      view: z.array(viewSchema),
    }),
  ),
});

export type Workbook = z.infer<typeof workbookSchema>;

// Query Workbook Connections response (rest_api_ref_workbooks_and_views.htm#query_workbook_connections).
// The nested datasource id is the queryable embedded datasource LUID — the point of this endpoint.
// Secret/host fields (serverAddress, serverPort, userName, embedPassword, connectionPassword) are
// deliberately omitted, following flow.ts's flowConnectionSchema.
// Everything but `id` is optional because Tableau Server/Cloud versions are inconsistent about which
// fields they emit; Zodios validates at the schema boundary, so one connection missing a datasource
// (or its name) would otherwise fail the entire queryWorkbookConnections() call.
export const workbookConnectionSchema = z.object({
  id: z.string(),
  type: z.string().optional(),
  datasource: z
    .object({
      id: z.string(),
      name: z.string().optional(),
    })
    .optional(),
});

export type WorkbookConnection = z.infer<typeof workbookConnectionSchema>;
