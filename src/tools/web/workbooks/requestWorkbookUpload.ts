import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { isBlobStorageEnabled } from '../../../blobStorage/init.js';
import { getTenantLuids } from '../../../blobStorage/tenantKey.js';
import { McpToolError, UnknownError } from '../../../errors/mcpToolError.js';
import { isAuthoringAllowedForClient } from '../../../features/authoringAccess.js';
import { getFeatureGate } from '../../../features/init.js';
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
      'Creates a short-lived staged upload URL for a Tableau TWB or TWBX workbook. Upload the workbook bytes to the returned URL, then call publish-workbook with the returned workbookUploadId.',
    paramsSchema,
    annotations: {
      title: 'Request Workbook Upload',
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

          if (!isBlobStorageEnabled()) {
            throw new UnknownError(
              'Blob storage provider must be configured before requesting staged workbook uploads.',
            );
          }

          // Non-OAuth publish signs in as the configured user, not the OAuth token user, so key by that.
          const sessionTenant = getTenantLuids(extra);
          if (extra.config.auth === 'oauth' && sessionTenant.isOk()) {
            return new Ok(
              await requestStagedWorkbookUpload({ fileName, tenant: sessionTenant.value }),
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
              return new Ok(await requestStagedWorkbookUpload({ fileName, tenant: tenant.value }));
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
