import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {};

export const getGetTableauServerInfoTool = (server: Server): Tool<typeof paramsSchema> => {
  const getTableauServerInfoTool = new Tool({
    server,
    name: 'get-tableau-server-info',
    description: `Gets information about the currently connected Tableau Server and the user connected to it.`,
    paramsSchema,
    annotations: {
      title: 'Get Tableau Server Info',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (_, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await getTableauServerInfoTool.logAndExecute({
        requestId,
        args: {},
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:sessions:read'],
              callback: async (restApi) => {
                const serverInfo = await restApi.serverMethods.getServerInfo();
                const currentSessionResult =
                  await restApi.authenticatedServerMethods.getCurrentServerSession();

                return {
                  serverUrl: config.server,
                  serverVersion: serverInfo.productVersion.value,
                  serverBuild: serverInfo.productVersion.build,
                  session: currentSessionResult.isOk()
                    ? currentSessionResult.value
                    : currentSessionResult.error,
                };
              },
            }),
          );
        },
      });
    },
  });

  return getTableauServerInfoTool;
};
