import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { pathParam } from '../../routeSafety/ids.js';
import { paginationSchema } from '../types/pagination.js';
import { workbookPermissionsSchema } from '../types/permissions.js';
import { tagsSchema } from '../types/tags.js';
import { workbookConnectionSchema, workbookSchema } from '../types/workbook.js';
import { paginationParameters } from './paginationParameters.js';

const getWorkbookEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/workbooks/:workbookId',
  alias: 'getWorkbook',
  description:
    'Returns information about the specified workbook, including information about views and tags.',
  parameters: [pathParam('siteId', 'segment'), pathParam('workbookId')],
  response: z.object({ workbook: workbookSchema }),
});

const queryWorkbooksForSiteEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/workbooks',
  alias: 'queryWorkbooksForSite',
  description: 'Returns the workbooks on a site.',
  parameters: [
    ...paginationParameters,
    pathParam('siteId', 'segment'),
    {
      name: 'filter',
      type: 'Query',
      schema: z.string().optional(),
      description:
        'An expression that lets you specify a subset of workbooks to return. You can filter on predefined fields such as name, tags, and createdAt. You can include multiple filter expressions.',
    },
  ],
  response: z.object({
    pagination: paginationSchema,
    workbooks: z.object({
      workbook: z.optional(z.array(workbookSchema)),
    }),
  }),
});

const deleteWorkbookEndpoint = makeEndpoint({
  method: 'delete',
  path: '/sites/:siteId/workbooks/:workbookId',
  alias: 'deleteWorkbook',
  description:
    'Deletes the specified workbook from the site. On Tableau Cloud the workbook is moved to the recycle bin and can be restored for a limited time.',
  parameters: [pathParam('siteId', 'segment'), pathParam('workbookId')],
  response: z.void(),
});

const addTagsToWorkbookEndpoint = makeEndpoint({
  method: 'put',
  path: '/sites/:siteId/workbooks/:workbookId/tags',
  alias: 'addTagsToWorkbook',
  description: 'Adds one or more tags to the specified workbook.',
  parameters: [
    pathParam('siteId', 'segment'),
    pathParam('workbookId'),
    {
      name: 'body',
      type: 'Body',
      schema: z.object({ tags: tagsSchema }),
    },
  ],
  response: z.object({ tags: tagsSchema }),
});

const queryWorkbookConnectionsEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/workbooks/:workbookId/connections',
  alias: 'queryWorkbookConnections',
  description:
    'Returns a list of data connections for the specified workbook, including the datasource each connection points to.',
  parameters: [pathParam('siteId', 'segment'), pathParam('workbookId')],
  response: z.object({
    connections: z.object({
      connection: z.optional(z.array(workbookConnectionSchema)),
    }),
  }),
});

/**
 * Query Workbook Permissions
 * GET /api/api-version/sites/site-id/workbooks/workbook-id/permissions
 * @see https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_permissions.htm#query_workbook_permissions
 */
const queryWorkbookPermissionsEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/workbooks/:workbookId/permissions',
  alias: 'queryWorkbookPermissions',
  description: 'Returns the permissions (grantee capabilities) for the specified workbook.',
  parameters: [pathParam('siteId', 'segment'), pathParam('workbookId')],
  response: workbookPermissionsSchema,
});

/**
 * Update Workbook
 * PUT /api/api-version/sites/site-id/workbooks/workbook-id
 * Modifies the project of the specified workbook.
 * Tableau Cloud scope: tableau:workbooks:update
 * @see https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_workbooks_and_views.htm#update_workbook
 */
const updateWorkbookEndpoint = makeEndpoint({
  method: 'put',
  path: '/sites/:siteId/workbooks/:workbookId',
  alias: 'updateWorkbook',
  description: 'Modifies the project of the specified workbook.',
  parameters: [
    pathParam('siteId', 'segment'),
    pathParam('workbookId'),
    {
      name: 'body',
      type: 'Body',
      schema: z.object({ workbook: z.object({ project: z.object({ id: z.string() }) }) }),
    },
  ],
  response: z.object({ workbook: workbookSchema.partial() }),
});

const workbooksApi = makeApi([
  queryWorkbooksForSiteEndpoint,
  getWorkbookEndpoint,
  queryWorkbookConnectionsEndpoint,
  queryWorkbookPermissionsEndpoint,
  deleteWorkbookEndpoint,
  addTagsToWorkbookEndpoint,
  updateWorkbookEndpoint,
]);

export const workbooksApis = [...workbooksApi] as const satisfies ZodiosEndpointDefinitions;
