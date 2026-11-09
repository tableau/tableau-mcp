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
};

export const getRequestDatasourceUploadTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'request-datasource-upload',
    minRequiredRole: SiteRole.EXPLORER_CAN_PUBLISH,
    description:
      'Creates a short-lived staged upload URL for a Tableau TDS or TDSX data source. Upload the data source bytes to the returned URL, then call publish-datasource with the returned datasourceUploadId.',
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
    callback: async ({ fileName }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<RequestDatasourceUploadResult>({
        extra,
        args: {
          fileName,
        },
        callback: async () => {
          if (
            extra.tableauAuthInfo?.type === 'Passthrough' ||
            extra.tableauAuthInfo?.type === 'ServerEas'
          ) {
            throw new UnknownError(
              'Staged data source upload is not available for Passthrough authentication or Server EAS. Use OAuth or server-side authentication so the upload flow can enforce MCP authorization before issuing a signed upload URL.',
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
                await requestStagedDatasourceUpload({ fileName, config, tenant: tenant.value }),
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
