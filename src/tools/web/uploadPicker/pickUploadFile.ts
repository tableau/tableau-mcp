// PROTOTYPE: file-upload picker MCP App. See PROTOTYPE.md at the repo root.
import { randomUUID } from 'crypto';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getBlobUploadOrigins } from '../../../blobStorage/init.js';
import { getFeatureGate } from '../../../features/init.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getAppConfig } from '../../../web/apps/appConfig.js';
import { getStagedUploadPreconditionError } from '../requestUpload.js';
import { getAvailableUploadFileTypes, MAX_STAGED_UPLOAD_BYTES } from '../stagedUpload.js';
import { WebTool } from '../tool.js';
import { isDatasourcePublishAvailable, isWorkbookPublishAvailable } from '../uploadAvailability.js';

const paramsSchema = {};

export type PickUploadFileResult = {
  uploadId: string;
  acceptedFileTypes: string[];
  maxSizeBytes: number;
  instructions: string;
};

export const getPickUploadFileTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'pick-upload-file',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Shows the user a file picker so they can upload a local workbook or data source file from their computer, without the file passing through the chat. Returns an uploadId; once the user reports the upload finished, pass uploadId to the matching publish tool. Prefer this over request-upload when the user has the file locally and you cannot read it.',
    paramsSchema,
    annotations: {
      title: 'Pick File to Upload',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    // No plain-tool fallback: without the iframe there is nothing to pick with; request-upload covers that.
    app: {
      ...getAppConfig('pick-upload-file', 'upload-picker'),
      hideWhenUnsupported: true,
      extraConnectDomains: getBlobUploadOrigins,
    },
    disabled: new Provider(
      async () =>
        !(await getFeatureGate().isFeatureEnabled('mcp-apps')) ||
        (!(await isWorkbookPublishAvailable(server.clientId)) &&
          !(await isDatasourcePublishAvailable(server.clientId))),
    ),
    callback: async (_args, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<PickUploadFileResult>({
        extra,
        args: {},
        callback: async () => {
          const preconditionError = getStagedUploadPreconditionError(extra);
          if (preconditionError) {
            return preconditionError.toErr();
          }

          const uploadId = randomUUID();
          return new Ok({
            uploadId,
            acceptedFileTypes: await getAvailableUploadFileTypes(server.clientId),
            maxSizeBytes: MAX_STAGED_UPLOAD_BYTES,
            instructions: `A file picker is shown to the user. Wait for them to confirm the upload finished, then pass uploadId ${uploadId} to the matching publish tool.`,
          });
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
