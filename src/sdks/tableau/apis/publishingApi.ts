import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';

import { multipartRequestSchema } from '../plugins/multipartPlugin.js';
import { fileUploadSchema } from '../types/fileUpload.js';

const initiateFileUploadEndpoint = makeEndpoint({
  method: 'post',
  path: `/sites/:siteId/fileUploads`,
  alias: 'initiateFileUpload',
  description: 'Initiates the upload process for a file.',
  response: fileUploadSchema,
});

const appendToFileUploadEndpoint = makeEndpoint({
  method: 'put',
  path: `/sites/:siteId/fileUploads/:uploadSessionId`,
  alias: 'appendToFileUpload',
  description: 'Uploads a block of data and appends it to the data that is already uploaded.',
  response: fileUploadSchema,
  parameters: [
    {
      name: 'body',
      type: 'Body',
      schema: multipartRequestSchema,
    },
  ],
});

const publishingApi = makeApi([initiateFileUploadEndpoint, appendToFileUploadEndpoint]);

export const publishingApis = [...publishingApi] as const satisfies ZodiosEndpointDefinitions;
