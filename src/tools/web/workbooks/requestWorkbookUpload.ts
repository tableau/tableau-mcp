import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { UnknownError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import {
  requestStagedWorkbookUpload,
  RequestWorkbookUploadResult,
  WORKBOOK_UPLOAD_CONTENT_TYPE,
} from './stagedWorkbookUpload.js';

const paramsSchema = {
  fileName: z
    .string()
    .min(1)
    .describe('Name of the Tableau workbook file to upload. Must end in .twb.'),
  contentType: z
    .string()
    .min(1)
    .optional()
    .describe('Content-Type header the client will send to the presigned upload URL.'),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('Optional expected workbook file size in bytes.'),
};

export const getRequestWorkbookUploadTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'request-workbook-upload',
    description:
      'Creates a short-lived staged upload URL for a Tableau TWB workbook. Upload the workbook bytes to the returned URL, then call validate-upload-and-publish-workbook with the returned workbookUploadId.',
    paramsSchema,
    annotations: {
      title: 'Request Workbook Upload',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('upload-validate-publish')),
    ),
    callback: async ({ fileName, contentType, sizeBytes }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<RequestWorkbookUploadResult>({
        extra,
        args: {
          fileName,
          contentType: contentType ?? WORKBOOK_UPLOAD_CONTENT_TYPE,
          sizeBytes,
        },
        callback: async () => {
          if (extra.tableauAuthInfo?.type === 'Passthrough') {
            throw new UnknownError(
              'Staged workbook upload is not available for Passthrough authentication. Use OAuth or server-side authentication so the upload flow can enforce MCP authorization before issuing a signed upload URL.',
            );
          }

          if (!extra.config.bucketS3.enabled) {
            throw new UnknownError(
              'MCP_S3_BUCKET must be configured before requesting staged workbook uploads.',
            );
          }

          const result = await requestStagedWorkbookUpload({
            fileName,
            contentType: contentType ?? WORKBOOK_UPLOAD_CONTENT_TYPE,
            sizeBytes,
            config: extra.config.bucketS3,
          });
          return new Ok(result);
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
        getSuccessResult: (result) => ({
          isError: false,
          structuredContent: result,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        }),
      });
    },
  });

  return tool;
};
