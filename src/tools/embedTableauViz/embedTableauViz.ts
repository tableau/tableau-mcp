import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import z from 'zod';

import { Server } from '../../server.js';
import { getJwt } from '../../utils/getJwt.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  workbookUrl: z.string(),
};

type EmbedVizResult = {
  url: string;
  token: string;
};

export const getEmbedTableauVizTool = (server: Server): Tool<typeof paramsSchema> => {
  const embedTableauVizTool = new Tool({
    server,
    name: 'embed-tableau-viz',
    app: {
      name: 'embed-tableau-viz',
      sandboxCapabilities: {
        csp: {
          connectDomains: ['https://*.tableau.com'],
          resourceDomains: ['https://*.tableau.com'],
          frameDomains: ['https://*.tableau.com'],
        },
      },
    },
    description: 'Embed a Tableau viz in a chat window.',
    paramsSchema,
    annotations: {
      title: 'Embed Tableau Viz',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ workbookUrl }, extra): Promise<CallToolResult> => {
      return await embedTableauVizTool.logAndExecute<EmbedVizResult>({
        extra,
        args: { workbookUrl },
        callback: async () => {
          const { config, tableauAuthInfo } = extra;
          let token = '';

          if (config.auth === 'direct-trust') {
            token = await getJwt({
              username: tableauAuthInfo?.username ?? config.jwtUsername,
              config: {
                type: 'connected-app',
                clientId: config.connectedAppClientId,
                secretId: config.connectedAppSecretId,
                secretValue: config.connectedAppSecretValue,
              },
              scopes: new Set(['tableau:views:embed']),
            });
          }

          return new Ok({ url: workbookUrl, token });
        },
        constrainSuccessResult: (result) => ({
          type: 'success',
          result,
        }),
      });
    },
  });

  return embedTableauVizTool;
};
