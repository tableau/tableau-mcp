import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

/**
 * The workbook-level publish/move mechanics live here rather than in workbooksApi.ts because the
 * publish request itself is multipart/mixed (see PublishingMethods.publishWorkbook), which does not
 * fit the JSON-oriented Zodios endpoint shape. The two endpoints that DO fit — reading the caller's
 * personal space and moving a published workbook — are defined here so they still get Zodios request
 * building, response validation, and the shared logging/masking interceptors.
 */

const personalSpaceSchema = z.object({
  // Tableau returns <personalSpace luid="..." ownerLuid="..."/>; JSON keys mirror the attributes.
  luid: z.string(),
  ownerLuid: z.string().optional(),
});

const getPersonalSpaceEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/personalSpace',
  alias: 'getPersonalSpace',
  description: "Returns the authenticated user's personal space, including its LUID.",
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
  ],
  response: z.object({ personalSpace: personalSpaceSchema }),
});

// Body for Update Workbook. Kept intentionally open: today we only send `location` (to move a
// workbook into Personal Space), but the same endpoint moves between projects (`project`) and
// renames (`name`) — leaving those here keeps the project flow a one-liner when we add it.
const updateWorkbookBodySchema = z.object({
  workbook: z.object({
    name: z.string().optional(),
    showTabs: z.boolean().optional(),
    project: z.object({ id: z.string() }).optional(),
    location: z.object({ id: z.string(), type: z.string() }).optional(),
  }),
});

const updateWorkbookEndpoint = makeEndpoint({
  method: 'put',
  path: '/sites/:siteId/workbooks/:workbookId',
  alias: 'updateWorkbook',
  description:
    'Updates a workbook. Used here to move a published workbook into Personal Space via <location>.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'workbookId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'body',
      type: 'Body',
      schema: updateWorkbookBodySchema,
    },
  ],
  // The update response echoes the workbook element. We only need its identity here, so keep the
  // schema lenient (passthrough) rather than reusing the strict workbookSchema — the move step must
  // not fail validation just because the update response omits an attribute the read API returns.
  response: z.object({
    workbook: z.object({ id: z.string(), name: z.string().optional() }).passthrough(),
  }),
});

const publishingApi = makeApi([getPersonalSpaceEndpoint, updateWorkbookEndpoint]);

export const publishingApis = [...publishingApi] as const satisfies ZodiosEndpointDefinitions;
