import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import {
  ArgsValidationError,
  FlowNotAllowedError,
  McpToolError,
} from '../../../errors/mcpToolError.js';
import { isFlowWriteToolsEnabled } from '../../../features/flowTools.js';
import { useRestApi } from '../../../restApiInstance.js';
import { luidSchema } from '../../../sdks/routeSafety/ids.js';
import { FlowConnection } from '../../../sdks/tableau/types/flow.js';
import {
  flowConnectionUpdateFields,
  flowConnectionUpdateSchema,
} from '../../../sdks/tableau/types/flowConnectionUpdate.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { resourceAccessChecker } from '../resourceAccessChecker.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  flowId: luidSchema.describe('The LUID of the flow whose connection to change.'),
  connectionId: luidSchema.describe(
    'A connection LUID belonging to this flow, from get-flow with includeConnections enabled.',
  ),
  ...flowConnectionUpdateFields,
};
export type UpdateFlowConnectionResult = {
  status: 'updated';
  flowId: string;
  connection: FlowConnection;
};

/** Changes one verified connection using only explicitly supplied, non-secret fields. */
export const getUpdateFlowConnectionTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'update-flow-connection',
    minRequiredRole: SiteRole.SITE_ADMINISTRATOR_EXPLORER,
    description:
      'Changes the server address, server port and/or username of one Prep flow connection. At least one field is required. Use get-flow to discover connections. This tool is restricted to administrators and never runs the flow. Passwords and authentication secrets are not accepted; manage credentials separately in Tableau. Connector-specific restrictions may prevent an update.',
    paramsSchema,
    disabled: new Provider(async () => !(await isFlowWriteToolsEnabled(getConfig()))),
    annotations: {
      title: 'Update Flow Connection',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    callback: async (
      { flowId, connectionId, serverAddress, serverPort, userName },
      extra,
    ): Promise<CallToolResult> =>
      await tool.logAndExecute<UpdateFlowConnectionResult>({
        extra,
        args: {
          flowId,
          connectionId,
          serverAddress: serverAddress === undefined ? undefined : '<redacted>',
          serverPort,
          userName: userName === undefined ? undefined : '<redacted>',
        },
        callback: async () => {
          const parsed = flowConnectionUpdateSchema.safeParse({
            serverAddress,
            serverPort,
            userName,
          });
          if (!parsed.success)
            return new ArgsValidationError(
              'Provide at least one valid serverAddress, serverPort or userName. Credentials are not supported.',
            ).toErr();
          const allowed = await resourceAccessChecker.isFlowAllowed({ flowId, extra });
          if (!allowed.allowed) return new FlowNotAllowedError(allowed.message).toErr();
          return await useRestApi<Result<UpdateFlowConnectionResult, McpToolError>>({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: async (restApi) => {
              const connections = await restApi.flowsMethods.queryFlowConnections({
                siteId: restApi.siteId,
                flowId,
              });
              if (!connections.some((item) => item.id.toLowerCase() === connectionId.toLowerCase()))
                return new ArgsValidationError(
                  'The connection does not belong to the requested flow or is not visible. No update was attempted.',
                ).toErr();
              const connection = await restApi.flowsMethods.updateFlowConnection({
                siteId: restApi.siteId,
                flowId,
                connectionId,
                updates: parsed.data,
              });
              if (
                connection.id.toLowerCase() !== connectionId.toLowerCase() ||
                (parsed.data.serverAddress !== undefined &&
                  connection.serverAddress?.toLowerCase() !==
                    parsed.data.serverAddress.toLowerCase()) ||
                (parsed.data.serverPort !== undefined &&
                  Number(connection.serverPort) !== parsed.data.serverPort) ||
                (parsed.data.userName !== undefined &&
                  (connection.userName ?? '') !== parsed.data.userName)
              )
                return new McpToolError({
                  type: 'flow-connection-update-unverified',
                  statusCode: 502,
                  message:
                    'Tableau did not confirm the requested connection after the update. The write may have succeeded; inspect the flow before retrying.',
                }).toErr();
              return new Ok({ status: 'updated', flowId, connection });
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
