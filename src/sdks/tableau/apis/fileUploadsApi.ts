import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { fileUploadSchema } from '../types/fileUpload.js';

const initiateFileUploadEndpoint = makeEndpoint({
  method: 'post',
  path: '/sites/:siteId/fileUploads',
  alias: 'initiateFileUpload',
  description:
    'Initiates the upload process for a file to be published as a data source or workbook, or to be attached to a Send-Now request. Returns an upload session ID to reference in follow-up Append to File Upload and Publish Workbook/Data Source calls.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
  ],
  response: z.object({ fileUpload: fileUploadSchema }),
});

/**
 * Not used by Zodios directly (the actual Append call bypasses Zodios's typed
 * request path — see FileUploadsMethods.appendToFileUpload — because Tableau
 * requires a multipart/mixed body Zodios cannot produce). Included here so the
 * endpoint is documented alongside `initiateFileUpload` and so `fileUploadsApis`
 * satisfies `ZodiosEndpointDefinitions` for the `FileUploadsMethods` constructor.
 */
const appendToFileUploadEndpoint = makeEndpoint({
  method: 'put',
  path: '/sites/:siteId/fileUploads/:uploadSessionId',
  alias: 'appendToFileUpload',
  description:
    'Appends a chunk of data to an upload session. Returns the total number of bytes uploaded so far.',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'uploadSessionId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'sequenceID',
      type: 'Query',
      schema: z.string().optional(),
    },
  ],
  response: z.object({ fileUpload: fileUploadSchema }),
});

const fileUploadsApi = makeApi([initiateFileUploadEndpoint, appendToFileUploadEndpoint]);

export const fileUploadsApis = [...fileUploadsApi] as const satisfies ZodiosEndpointDefinitions;
