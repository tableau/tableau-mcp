import './datasources/stagedDatasourceUpload.js';
import './workbooks/stagedWorkbookUpload.js';

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { isBlobStorageEnabled } from '../../blobStorage/init.js';
import { getTenantLuids, type TenantLuids } from '../../blobStorage/tenantKey.js';
import { McpToolError, UnknownError } from '../../errors/mcpToolError.js';
import { useRestApi } from '../../restApiInstance.js';
import { SiteRole } from '../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../server.web.js';
import { TableauApiScope } from '../../server/oauth/scopes.js';
import { Provider } from '../../utils/provider.js';
import { getAvailableUploadFileTypes, requestStagedUpload } from './stagedUpload.js';
import { WebTool } from './tool.js';
import { TableauWebRequestHandlerExtra } from './toolContext.js';
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
        callback: async () =>
          await issueStagedUpload({
            requiredApiScopes: tool.requiredApiScopes,
            server,
            extra,
            fileName,
          }),
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

/** Staged-upload preconditions shared by request-upload and the upload picker tools. */
export function getStagedUploadPreconditionError(
  extra: TableauWebRequestHandlerExtra,
): McpToolError | undefined {
  if (extra.tableauAuthInfo?.type === 'Passthrough') {
    return new UnknownError(
      'Staged upload is not available for Passthrough authentication. Use OAuth or server-side authentication so the upload flow can enforce MCP authorization before issuing a signed upload URL.',
    );
  }

  if (!isBlobStorageEnabled()) {
    return new UnknownError(
      'Blob storage provider must be configured before requesting staged uploads.',
    );
  }
}

/**
 * Enforces the staged-upload preconditions and resolves the caller's tenant before signing an
 * upload URL. Shared with the upload picker's app-only get-upload-url tool.
 */
export async function issueStagedUpload({
  requiredApiScopes,
  server,
  extra,
  fileName,
  uploadId,
}: {
  requiredApiScopes: ReadonlyArray<TableauApiScope>;
  server: WebMcpServer;
  extra: TableauWebRequestHandlerExtra;
  fileName: string;
  uploadId?: string;
}): Promise<Result<RequestUploadResult, McpToolError>> {
  // Thrown, not returned, to keep request-upload's existing error result; the picker tools check first.
  const preconditionError = getStagedUploadPreconditionError(extra);
  if (preconditionError) {
    throw preconditionError;
  }

  const request = (tenant: TenantLuids): Promise<RequestUploadResult> =>
    requestStagedUpload({
      fileName,
      clientId: server.clientId,
      tenant,
      ...(uploadId !== undefined && { uploadId }),
    });

  // Non-OAuth publish signs in as the configured user, not the OAuth token user, so key by that.
  const sessionTenant = getTenantLuids(extra);
  if (extra.config.auth === 'oauth' && sessionTenant.isOk()) {
    return new Ok(await request(sessionTenant.value));
  }

  return await useRestApi<Result<RequestUploadResult, McpToolError>>({
    ...extra,
    jwtScopes: requiredApiScopes,
    callback: async () => {
      const tenant = getTenantLuids(extra);
      if (tenant.isErr()) {
        return tenant;
      }
      return new Ok(await request(tenant.value));
    },
  });
}
