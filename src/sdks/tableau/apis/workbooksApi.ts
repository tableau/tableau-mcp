import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { paginationSchema } from '../types/pagination.js';
import { tagsSchema } from '../types/tags.js';
import { workbookSchema } from '../types/workbook.js';
import { workbookValidationResultSchema } from '../types/workbookValidation.js';
import { paginationParameters } from './paginationParameters.js';

const getWorkbookEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/workbooks/:workbookId',
  alias: 'getWorkbook',
  description:
    'Returns information about the specified workbook, including information about views and tags.',
  response: z.object({ workbook: workbookSchema }),
});

const queryWorkbooksForSiteEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/workbooks',
  alias: 'queryWorkbooksForSite',
  description: 'Returns the workbooks on a site.',
  parameters: [
    ...paginationParameters,
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
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
  ],
  response: z.void(),
});

const addTagsToWorkbookEndpoint = makeEndpoint({
  method: 'put',
  path: '/sites/:siteId/workbooks/:workbookId/tags',
  alias: 'addTagsToWorkbook',
  description: 'Adds one or more tags to the specified workbook.',
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
      schema: z.object({ tags: tagsSchema }),
    },
  ],
  response: z.object({ tags: tagsSchema }),
});

const publishWorkbookEndpoint = makeEndpoint({
  method: 'post',
  path: '/sites/:siteId/workbooks',
  alias: 'publishWorkbook',
  description:
    'Publishes a workbook on the specified site, committing a file previously uploaded via Initiate File Upload and Append to File Upload calls.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'uploadSessionId',
      type: 'Query',
      schema: z.string(),
    },
    {
      name: 'workbookType',
      type: 'Query',
      schema: z.enum(['twb', 'twbx']),
    },
    {
      name: 'overwrite',
      type: 'Query',
      schema: z.boolean().optional(),
    },
  ],
  response: z.object({ workbook: workbookSchema }),
});

const validateUploadedWorkbookEndpoint = makeEndpoint({
  method: 'post',
  path: '/sites/:siteId/workbooks/validateUploadedWorkbook',
  alias: 'validateUploadedWorkbook',
  description: 'Validates a workbook that has been uploaded to the site via a file upload session.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'uploadSessionId',
      type: 'Query',
      schema: z.string(),
      description: 'The ID of the file upload session containing the workbook to validate.',
    },
  ],
  response: workbookValidationResultSchema,
});

const workbooksApi = makeApi([
  queryWorkbooksForSiteEndpoint,
  getWorkbookEndpoint,
  deleteWorkbookEndpoint,
  addTagsToWorkbookEndpoint,
  publishWorkbookEndpoint,
  validateUploadedWorkbookEndpoint,
]);

export const workbooksApis = [...workbooksApi] as const satisfies ZodiosEndpointDefinitions;
