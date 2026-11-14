import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { UnknownError } from '../../../errors/mcpToolError.js';
import { isAuthoringAllowedForClient } from '../../../features/authoringAccess.js';
import { isFlowWriteToolsEnabled } from '../../../features/flowTools.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import { RequestFlowUploadResult, requestStagedFlowUpload } from './stagedFlowUpload.js';

const paramsSchema = {
  fileName: z
    .string()
    .min(1)
    .describe('Name of the Tableau Prep flow file to upload. Must end in .tfl or .tflx.'),
};

export const getRequestFlowUploadTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'request-flow-upload',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Creates a short-lived staged upload URL for a Tableau TFL or TFLX Prep flow. Upload the Prep flow bytes to the returned URL, then call publish-flow with the returned flowUploadId.',
    paramsSchema,
    annotations: {
      title: 'Request Flow Upload',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(
      async () =>
        !(await isFlowWriteToolsEnabled(getConfig())) ||
        !(await isAuthoringAllowedForClient(server.clientId)),
    ),
    callback: async ({ fileName }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<RequestFlowUploadResult>({
        extra,
        args: {
          fileName,
        },
        callback: async () => {
          if (extra.tableauAuthInfo?.type === 'Passthrough') {
            return new UnknownError(
              'Staged Prep flow upload is not available for Passthrough authentication. Use OAuth or server-side authentication so the upload flow can enforce MCP authorization before issuing a signed upload URL.',
            ).toErr();
          }

          if (!extra.config.bucketS3.enabled) {
            return new UnknownError(
              'MCP_S3_BUCKET must be configured before requesting staged Prep flow uploads.',
            ).toErr();
          }

          const result = await requestStagedFlowUpload({
            fileName,
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
