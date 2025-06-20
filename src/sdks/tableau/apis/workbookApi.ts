import { makeApi, makeEndpoint, ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';
import { AxiosError } from 'axios';
import { z } from 'zod';

import { multipartRequestSchema } from '../plugins/postMultipartPlugin.js';
import { restApiErrorSchema } from '../types/restApiError.js';
import { workbookSchema } from '../types/workbook.js';

const queryWorkbooksForSiteEndpoint = makeEndpoint({
  method: 'get',
  path: `/sites/:siteId/workbooks?filter=projectName${encodeURIComponent(':eq:')}:projectName`,
  alias: 'queryWorkbooksForSite',
  description: 'Returns the workbooks on a site.',
  response: z.object({
    workbooks: z.object({
      workbook: z.optional(z.array(workbookSchema)),
    }),
  }),
});

const deleteWorkbookEndpoint = makeEndpoint({
  method: 'delete',
  path: `/sites/:siteId/workbooks/:workbookId`,
  alias: 'deleteWorkbook',
  description:
    'Deletes a workbook. When a workbook is deleted, all of its assets are also deleted, including associated views, data connections, and so on.',
  response: z.void(),
});

const publishWorkbookEndpoint = makeEndpoint({
  method: 'post',
  path: `/sites/:siteId/workbooks`,
  alias: 'publishWorkbook',
  description: 'Publishes a workbook on the specified site.',
  response: z.object({ workbook: workbookSchema }),
  parameters: [
    {
      name: 'body',
      type: 'Body',
      schema: multipartRequestSchema,
    },
  ],
});

export function throwIfPublishFailed(e: unknown, workbookName: string): void {
  if (e instanceof AxiosError && e.status === 403) {
    const { success, data } = restApiErrorSchema.safeParse(e.response?.data);

    if (
      success &&
      data.error.code === '403130' &&
      data.error.detail.includes(
        `The workbook '${workbookName}' already exists and may not be overwritten without the 'overwrite' flag set to 'true'.`,
      )
    ) {
      console.debug(`The workbook '${workbookName}' already exists.`);
      return;
    }
  }

  throw e;
}

const workbookApi = makeApi([
  queryWorkbooksForSiteEndpoint,
  deleteWorkbookEndpoint,
  publishWorkbookEndpoint,
]);

export const workbookApis = [...workbookApi] as const satisfies ZodiosEndpointDefinitions;
export type WorkbookApiClient = ZodiosInstance<typeof workbookApis>;
