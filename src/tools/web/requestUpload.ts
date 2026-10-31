import './datasources/stagedDatasourceUpload.js';
import './workbooks/stagedWorkbookUpload.js';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { isBlobStorageEnabled } from '../../blobStorage/init.js';
import { getTenantLuids } from '../../blobStorage/tenantKey.js';
import { McpToolError, UnknownError } from '../../errors/mcpToolError.js';
import { useRestApi } from '../../restApiInstance.js';
import { SiteRole } from '../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../server.web.js';
import { Provider } from '../../utils/provider.js';
import { getAvailableUploadFileTypes, requestStagedUpload } from './stagedUpload.js';
import { WebTool } from './tool.js';
import { isDatasourcePublishAvailable, isWorkbookPublishAvailable } from './uploadAvailability.js';

const paramsSchema = {
  fileName: z
    .string()
    .min(1)
    .describe('Name of the file to upload, e.g. Sales.twbx. The extension selects the file type.'),
};

type RequestUploadResult = Awaited<ReturnType<typeof requestStagedUpload>>;

export const getRequestUploadTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'request-upload',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description: new Provider(
      async () =>
        `Creates a short-lived upload URL for a file (${(
          await getAvailableUploadFileTypes(server.clientId)
        )
          .map((type) => `.${type}`)
          .join(
            ', ',
          )}). PUT the file bytes to the returned uploadUrl with requiredHeaders, then pass uploadId to the matching publish tool.`,
    ),
    paramsSchema,
    annotations: {
      title: 'Request Upload',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    // Available when at least one consuming publish tool is.
    disabled: new Provider(
      async () =>
        !(await isWorkbookPublishAvailable(server.clientId)) &&
        !(await isDatasourcePublishAvailable(server.clientId)),
    ),
    callback: async ({ fileName }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<RequestUploadResult>({
        extra,
        args: { fileName },
        callback: async () => {
          if (extra.tableauAuthInfo?.type === 'Passthrough') {
            throw new UnknownError(
              'Staged upload is not available for Passthrough authentication. Use OAuth or server-side authentication so the upload flow can enforce MCP authorization before issuing a signed upload URL.',
            );
          }

          if (!isBlobStorageEnabled()) {
            throw new UnknownError(
              'Blob storage provider must be configured before requesting staged uploads.',
            );
          }

          // Non-OAuth publish signs in as the configured user, not the OAuth token user, so key by that.
          const sessionTenant = getTenantLuids(extra);
          if (extra.config.auth === 'oauth' && sessionTenant.isOk()) {
            return new Ok(
              await requestStagedUpload({
                fileName,
                clientId: server.clientId,
                tenant: sessionTenant.value,
              }),
            );
          }

          return await useRestApi<Result<RequestUploadResult, McpToolError>>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async () => {
              const tenant = getTenantLuids(extra);
              if (tenant.isErr()) {
                return tenant;
              }
              return new Ok(
                await requestStagedUpload({
                  fileName,
                  clientId: server.clientId,
                  tenant: tenant.value,
                }),
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
