import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { UnknownError } from '../../../errors/mcpToolError.js';
import { isAuthoringAllowedForClient } from '../../../features/authoringAccess.js';
import { getFeatureGate } from '../../../features/init.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import {
  RequestDatasourceUploadResult,
  requestStagedDatasourceUpload,
} from './stagedDatasourceUpload.js';

const paramsSchema = {
  fileName: z
    .string()
    .min(1)
    .describe('Name of the data source file to upload. Must end in .tdsx or .hyper.'),
};

export const getRequestDatasourceUploadTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'request-datasource-upload',
    minRequiredRole: SiteRole.CREATOR,
    description:
      'Creates a short-lived staged upload URL for a Tableau TDSX or HYPER data source file. Upload the file bytes to the returned URL with the returned requiredHeaders (for example `curl -T <file> -H "Content-Type: application/octet-stream" <uploadUrl>`), then call publish-datasource with the returned datasourceUploadId.',
    paramsSchema,
    annotations: {
      title: 'Request Data Source Upload',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(
      async () =>
        !(await getFeatureGate().isFeatureEnabled('authoring-tools')) ||
        !(await isAuthoringAllowedForClient(server.clientId)),
    ),
    callback: async ({ fileName }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<RequestDatasourceUploadResult>({
        extra,
        args: {
          fileName,
        },
        callback: async () => {
          if (extra.tableauAuthInfo?.type === 'Passthrough') {
            throw new UnknownError(
              'Staged data source upload is not available for Passthrough authentication. Use OAuth or server-side authentication so the upload flow can enforce MCP authorization before issuing a signed upload URL.',
            );
          }

          if (!extra.config.bucketS3.enabled) {
            throw new UnknownError(
              'MCP_S3_BUCKET must be configured before requesting staged data source uploads.',
            );
          }

          const result = await requestStagedDatasourceUpload({
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
