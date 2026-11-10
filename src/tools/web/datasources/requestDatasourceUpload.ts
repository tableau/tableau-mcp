import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import { getTenantLuids } from '../../../blobStorage/tenantKey.js';
import { McpToolError, UnknownError } from '../../../errors/mcpToolError.js';
import { isAuthoringAllowedForClient } from '../../../features/authoringAccess.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { MAX_STAGED_UPLOAD_BYTES } from '../stagedUpload.js';
import { WebTool } from '../tool.js';
import {
  RequestDatasourceUploadResult,
  requestStagedDatasourceUpload,
} from './stagedDatasourceUpload.js';

const paramsSchema = {
  fileName: z
    .string()
    .min(1)
    .describe('Name of the Tableau data source file to upload. Must end in .tds or .tdsx.'),
  fileSizeBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_STAGED_UPLOAD_BYTES)
    .describe('Exact file size in bytes; the upload must send exactly this many bytes.'),
};

export const getRequestDatasourceUploadTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'request-datasource-upload',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Creates a short-lived staged upload URL for a Tableau TDS or TDSX data source. PUT exactly fileSizeBytes bytes to the returned URL with the returned requiredHeaders, then call publish-datasource with the returned datasourceUploadId. Each upload id can be published once.',
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
        !(await getFeatureGate().isFeatureEnabled('datasource-authoring')) ||
        !(await isAuthoringAllowedForClient(server.clientId)),
    ),
    callback: async ({ fileName, fileSizeBytes }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<RequestDatasourceUploadResult>({
        extra,
        args: {
          fileName,
          fileSizeBytes,
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
              await requestStagedDatasourceUpload({
                fileName,
                fileSizeBytes,
                config,
                tenant: tenant.value,
              }),
            );
          }

          return await useRestApi<Result<RequestDatasourceUploadResult, McpToolError>>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async () => {
              const tenant = getTenantLuids(extra);
              if (tenant.isErr()) {
                return tenant;
              }
              return new Ok(
                await requestStagedDatasourceUpload({
                  fileName,
                  fileSizeBytes,
                  config,
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
