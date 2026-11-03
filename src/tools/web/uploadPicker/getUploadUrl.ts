// PROTOTYPE: file-upload picker MCP App. See PROTOTYPE.md at the repo root.
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getStagedUploadPreconditionError, issueStagedUpload } from '../requestUpload.js';
import { MAX_STAGED_UPLOAD_BYTES } from '../stagedUpload.js';
import { WebTool } from '../tool.js';
import { isDatasourcePublishAvailable, isWorkbookPublishAvailable } from '../uploadAvailability.js';

const paramsSchema = {
  uploadId: z.string().uuid().describe('The uploadId returned by pick-upload-file.'),
  fileName: z.string().min(1).describe('Name of the picked file; the extension selects the type.'),
  fileSize: z.number().int().nonnegative().describe('Size of the picked file in bytes.'),
};

export type GetUploadUrlResult = {
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt?: string;
  maxSizeBytes: number;
};

/**
 * App-only: signs an upload URL for the file the user picked in the upload picker. Kept off the
 * model so the presigned URL never enters the conversation.
 */
export const getGetUploadUrlTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'get-upload-url',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description: 'Creates a short-lived upload URL for a file picked in the upload picker.',
    paramsSchema,
    annotations: {
      title: 'Get Upload URL',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    meta: {
      ui: {
        visibility: ['app'],
      },
    },
    disabled: new Provider(
      async () =>
        !(await getFeatureGate().isFeatureEnabled('mcp-apps')) ||
        (!(await isWorkbookPublishAvailable(server.clientId)) &&
          !(await isDatasourcePublishAvailable(server.clientId))),
    ),
    callback: async ({ uploadId, fileName, fileSize }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<GetUploadUrlResult>({
        extra,
        args: { uploadId, fileName, fileSize },
        callback: async () => {
          if (fileSize > MAX_STAGED_UPLOAD_BYTES) {
            return new ArgsValidationError(
              `File exceeds the maximum allowed size of ${MAX_STAGED_UPLOAD_BYTES} bytes.`,
            ).toErr();
          }
          const preconditionError = getStagedUploadPreconditionError(extra);
          if (preconditionError) {
            return preconditionError.toErr();
          }
          const staged = await issueStagedUpload({
            requiredApiScopes: tool.requiredApiScopes,
            server,
            extra,
            fileName,
            uploadId,
          });
          return staged.map(({ uploadUrl, requiredHeaders, expiresAt, maxSizeBytes }) => ({
            uploadUrl,
            requiredHeaders,
            expiresAt,
            maxSizeBytes,
          }));
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
