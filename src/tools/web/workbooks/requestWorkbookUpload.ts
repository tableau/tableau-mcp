import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getTenantLuids } from '../../../blobStorage/tenantKey.js';
import { McpToolError, UnknownError } from '../../../errors/mcpToolError.js';
import { isAuthoringAllowedForClient } from '../../../features/authoringAccess.js';
import { useRestApi } from '../../../restApiInstance.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import {
  requestStagedWorkbookUpload,
  RequestWorkbookUploadResult,
} from './stagedWorkbookUpload.js';

const paramsSchema = {
  fileName: z
    .string()
    .min(1)
    .describe('Name of the Tableau workbook file to upload. Must end in .twb or .twbx.'),
};

export const getRequestWorkbookUploadTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'request-workbook-upload',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Creates a short-lived staged upload URL for a Tableau TWB or TWBX workbook. Upload the workbook bytes to the returned URL, then call publish-workbook with the returned workbookUploadId. Each upload id can be published once.',
    paramsSchema,
    annotations: {
      title: 'Request Workbook Upload',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    disabled: new Provider(async () => !(await isAuthoringAllowedForClient(server.clientId))),
    callback: async ({ fileName }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<RequestWorkbookUploadResult>({
        extra,
        args: {
          fileName,
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

          const config = extra.config.bucketS3;

          // Non-OAuth modes (PAT/UAT/direct-trust) have no LUIDs until REST sign-in, which populates
          // them for getTenantLuids. Publish signs in as the same configured user, so the staged key
          // matches. Costs one sign-in/sign-out per request; OAuth reads LUIDs from the token.
          if (extra.config.auth === 'oauth') {
            const tenant = getTenantLuids(extra);
            if (tenant.isErr()) {
              return tenant;
            }
            return new Ok(
              await requestStagedWorkbookUpload({ fileName, config, tenant: tenant.value }),
            );
          }

          return await useRestApi<Result<RequestWorkbookUploadResult, McpToolError>>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async () => {
              const tenant = getTenantLuids(extra);
              if (tenant.isErr()) {
                return tenant;
              }
              return new Ok(
                await requestStagedWorkbookUpload({ fileName, config, tenant: tenant.value }),
              );
            },
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
